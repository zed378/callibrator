/**
 * E2E Tests: Tenant Backup module (mounted at /api/v1/tenants)
 *
 * Live smoke coverage:
 *  - GET    /tenants/:tenantId/backups             — list (paginated, meta sibling)
 *  - GET    /tenants/:tenantId/backups/stats        — aggregate stats
 *  - POST   /tenants/:tenantId/backups              — create backup (201)
 *  - GET    /tenants/:tenantId/backups/:backupId    — detail
 *  - DELETE /tenants/:tenantId/backups/:backupId    — delete
 *
 * Guarded by rbac(SUPER_ADMIN|TENANT_ADMIN) + abac(tenant:*) with checkTenant.
 */
const { httpGet, httpPost, httpDelete, extractToken, authHeader } = require("../setup");

describe("E2E Tenant Backup (HTTP)", () => {
  let token;
  let tenantId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();

    const { body: tb } = await httpGet("/tenants/all?limit=1", authHeader(token));
    tenantId = tb?.data?.[0]?.id;
    expect(tenantId).toBeTruthy();
  });

  test("GET /tenants/:tenantId/backups — 401 without auth", async () => {
    const { status } = await httpGet(`/tenants/${tenantId}/backups`);
    expect(status).toBe(401);
  });

  test("GET /tenants/:tenantId/backups — 200 list with top-level meta", async () => {
    const { status, body } = await httpGet(`/tenants/${tenantId}/backups`, authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("GET /tenants/:tenantId/backups/stats — 200 stats object", async () => {
    const { status, body } = await httpGet(`/tenants/${tenantId}/backups/stats`, authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("POST /tenants/:tenantId/backups — 400 when required name is missing", async () => {
    const { status } = await httpPost(
      `/tenants/${tenantId}/backups`,
      { backupType: "USER_ONLY" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("POST /tenants/:tenantId/backups — 201 then detail + delete", async () => {
    const { status: cStatus, body } = await httpPost(
      `/tenants/${tenantId}/backups`,
      { name: "E2E Backup", backupType: "USER_ONLY", retentionDays: 30 },
      authHeader(token),
    );
    expect(cStatus).toBe(201);
    const backupId = body?.data?.id;
    expect(backupId).toBeTruthy();

    const { status: gStatus } = await httpGet(`/tenants/${tenantId}/backups/${backupId}`, authHeader(token));
    expect(gStatus).toBe(200);

    const { status: dStatus } = await httpDelete(`/tenants/${tenantId}/backups/${backupId}`, authHeader(token));
    expect(dStatus).toBe(200);
  });
});
