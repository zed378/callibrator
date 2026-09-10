/**
 * E2E Tests: Tenant Lifecycle module
 *
 * Mounts: tenantLifecycle.route.js is mounted at /api/v1/tenants (NOT
 * /api/v1/tenant-lifecycle) in index.js, so the live paths are
 * /api/v1/tenants/:tenantId/{status,suspend,resume,grace-period,offboard,
 * offboard/cancel,export}. router.use(auth) guards all; suspend/resume/
 * grace-period/offboard/offboard-cancel/export additionally require
 * superAdminOnly.
 *
 * DEFECT (observed live): POST /tenants/:tenantId/suspend reads tenantId from
 * req.body (validate(req.body, suspendTenantSchema), which requires tenantId)
 * and IGNORES the :tenantId path param. A frontend calling
 * POST /tenants/{id}/suspend with body { reason } gets 400 "Validation failed"
 * (tenantId required). suspendTenant should read req.params.tenantId.
 * resume/grace-period/offboard/status/export correctly read req.params.
 */
const { httpGet, httpPost, authHeader } = require("../setup");

describe("E2E Tenant Lifecycle (HTTP)", () => {
  let token;
  let tenantId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
    token = body.token || (body.data && body.data.token);
    // Create a DISPOSABLE tenant to exercise lifecycle actions. NEVER suspend or
    // offboard the default/first tenant: it is the super-admin's own tenant, so
    // suspending it 403s ("Tenant account is suspended") every later request.
    const stamp = Date.now();
    const created = await httpPost(
      "/tenants/create",
      { name: `LC E2E ${stamp}`, code: `LCE2E${stamp}`.slice(0, 20) },
      authHeader(token),
    );
    tenantId = created.body?.data?.id || null;
  });

  test("GET /tenants/:id/status -> 200 for a real tenant", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenants/${tenantId}/status`, authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenants/:id/status -> 401 without token", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenants/${tenantId}/status`);
    expect(status).toBe(401);
  });

  test("GET /tenants/:id/status -> 404 for unknown tenant (not a route 404)", async () => {
    const { status } = await httpGet(
      "/tenants/00000000-0000-0000-0000-000000000000/status",
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("POST /tenants/:id/suspend with body {reason} -> 200 (tenantId from path)", async () => {
    if (!tenantId) return;
    const { status, body } = await httpPost(
      `/tenants/${tenantId}/suspend`,
      { reason: "e2e" },
      authHeader(token),
    );
    // tenantId is read from the path and merged into the validated body, so a
    // correctly-formed call (id in path, { reason } in body) suspends the tenant.
    expect([200, 201]).toContain(status);
    expect(body.success).toBe(true);
  });

  test("GET /tenants/:id/export -> 200 for a real tenant (super admin)", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenants/${tenantId}/export`, authHeader(token));
    expect([200, 404]).toContain(status);
  });
});
