/**
 * E2E Tests: Feature Flags module (/api/v1/feature-flags)
 *
 * Live smoke coverage:
 *  - GET  /feature-flags?tenantId=      — effective flags for a tenant
 *  - GET  /feature-flags/definitions    — flag catalog
 *  - POST /feature-flags/:tenantId/initialize — seed defaults (super admin)
 *  - GET  /feature-flags/:tenantId/:flagKey   — flag status
 *  - POST /feature-flags/:tenantId/:flagKey   — set override (super admin)
 *  - DELETE /feature-flags/:tenantId/:flagKey — reset to default (super admin)
 *
 * NOTE: setTenantFlag validates req.body against a schema that REQUIRES
 * tenantId + flagKey (both are path params). The request body must therefore
 * redundantly carry tenantId and flagKey in addition to `enabled`.
 */
const { httpGet, httpPost, httpDelete, extractToken, authHeader } = require("../setup");

describe("E2E Feature Flags (HTTP)", () => {
  let token;
  let tenantId;
  let flagKey;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();

    // Use a DISPOSABLE tenant so flag overrides don't mutate the default tenant.
    const stamp = Date.now();
    const { body: tb } = await httpPost(
      "/tenants/create",
      { name: `FF E2E ${stamp}`, code: `FFE2E${stamp}`.slice(0, 20) },
      authHeader(token),
    );
    tenantId = tb?.data?.id;
    expect(tenantId).toBeTruthy();

    const { body: db } = await httpGet("/feature-flags/definitions", authHeader(token));
    const d = db?.data;
    flagKey = Array.isArray(d) ? (d[0]?.key || d[0]) : Object.keys(d || {})[0];
    flagKey = flagKey || "enable_iot";
  });

  test("GET /feature-flags/definitions — 401 without auth", async () => {
    const { status } = await httpGet("/feature-flags/definitions");
    expect(status).toBe(401);
  });

  test("GET /feature-flags/definitions — 200 catalog", async () => {
    const { status, body } = await httpGet("/feature-flags/definitions", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("data");
  });

  test("GET /feature-flags?tenantId= — 200 effective flags", async () => {
    const { status, body } = await httpGet(`/feature-flags?tenantId=${tenantId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("GET /feature-flags — 400 when tenantId query missing", async () => {
    const { status } = await httpGet("/feature-flags", authHeader(token));
    expect(status).toBe(400);
  });

  test("POST /feature-flags/:tenantId/initialize — seeds defaults", async () => {
    const { status, body } = await httpPost(`/feature-flags/${tenantId}/initialize`, {}, authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
  });

  test("GET /feature-flags/:tenantId/:flagKey — 200 flag status", async () => {
    const { status, body } = await httpGet(`/feature-flags/${tenantId}/${flagKey}`, authHeader(token));
    expect(status).toBe(200);
    expect(body?.data).toHaveProperty("enabled");
  });

  test("POST /feature-flags/:tenantId/:flagKey — full body (tenantId+flagKey+enabled) succeeds", async () => {
    const { status, body } = await httpPost(
      `/feature-flags/${tenantId}/${flagKey}`,
      { tenantId, flagKey, enabled: true },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
  });

  test("POST /feature-flags/:tenantId/:flagKey — body {enabled} succeeds (path params merged)", async () => {
    const { status } = await httpPost(
      `/feature-flags/${tenantId}/${flagKey}`,
      { enabled: true },
      authHeader(token),
    );
    // tenantId + flagKey come from the path and are merged into the validated
    // body, so the documented { enabled } payload is accepted.
    expect([200, 201]).toContain(status);
  });

  test("DELETE /feature-flags/:tenantId/:flagKey — reset to default", async () => {
    const { status } = await httpDelete(`/feature-flags/${tenantId}/${flagKey}`, authHeader(token));
    expect(status).toBe(200);
  });
});
