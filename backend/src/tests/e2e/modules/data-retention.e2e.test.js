/**
 * E2E Tests: Data Retention module (mounted at /api/v1/tenants)
 *
 * Live smoke coverage:
 *  - GET  /tenants/:tenantId/policy      — retention policy
 *  - PUT  /tenants/:tenantId/policy       — set policy (super admin)
 *  - GET  /tenants/:tenantId/legal-hold   — legal hold status
 *  - POST /tenants/:tenantId/legal-hold   — enable legal hold (super admin)
 *  - DELETE /tenants/:tenantId/legal-hold — disable legal hold (super admin)
 *  - POST /tenants/:tenantId/purge        — purge expired records (super admin)
 *
 * KNOWN DEFECTS captured here:
 *  1. setRetentionPolicy validates req.BODY against a schema requiring tenantId
 *     (the tenantId lives in the PATH), so the swagger-documented body
 *     {policyKey, days} is rejected; the body must also carry tenantId.
 *  2. enableLegalHold builds its schema by spreading a Joi object
 *     ({ ...tenantIdSchema, reason }) and calling schema.validate — the spread
 *     loses the prototype .validate method, throwing and returning HTTP 500.
 */
const { httpGet, httpPost, httpPut, httpDelete, extractToken, authHeader } = require("../setup");

describe("E2E Data Retention (HTTP)", () => {
  let token;
  let tenantId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();

    // Use a DISPOSABLE tenant so retention policies / legal holds don't pollute
    // the default tenant (a legal hold on it would block its own purges).
    const stamp = Date.now();
    const { body: tb } = await httpPost(
      "/tenants/create",
      { name: `DR E2E ${stamp}`, code: `DRE2E${stamp}`.slice(0, 20) },
      authHeader(token),
    );
    tenantId = tb?.data?.id;
    expect(tenantId).toBeTruthy();
  });

  test("GET /tenants/:tenantId/policy — 401 without auth", async () => {
    const { status } = await httpGet(`/tenants/${tenantId}/policy`);
    expect(status).toBe(401);
  });

  test("GET /tenants/:tenantId/policy — 200", async () => {
    const { status } = await httpGet(`/tenants/${tenantId}/policy`, authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenants/:tenantId/legal-hold — 200 status", async () => {
    const { status, body } = await httpGet(`/tenants/${tenantId}/legal-hold`, authHeader(token));
    expect(status).toBe(200);
    expect(body?.data).toHaveProperty("onLegalHold");
  });

  test("PUT /tenants/:tenantId/policy — succeeds only when body carries tenantId", async () => {
    const { status } = await httpPut(
      `/tenants/${tenantId}/policy`,
      { tenantId, policyKey: "audit_logs", days: 365 },
      authHeader(token),
    );
    expect(status).toBe(200);
  });

  test("PUT /tenants/:tenantId/policy — accepts body {policyKey,days} (tenantId from path)", async () => {
    const { status } = await httpPut(
      `/tenants/${tenantId}/policy`,
      { policyKey: "audit_logs", days: 365 },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
  });

  test("POST /tenants/:tenantId/legal-hold — 200 with a proper schema (tenantId from path)", async () => {
    const { status } = await httpPost(
      `/tenants/${tenantId}/legal-hold`,
      { reason: "litigation" },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
  });

  test("DELETE /tenants/:tenantId/legal-hold — 200 disables hold", async () => {
    const { status } = await httpDelete(`/tenants/${tenantId}/legal-hold`, authHeader(token));
    expect(status).toBe(200);
  });

  test("POST /tenants/:tenantId/purge — 200 purge completed", async () => {
    const { status } = await httpPost(`/tenants/${tenantId}/purge`, {}, authHeader(token));
    expect(status).toBe(200);
  });
});
