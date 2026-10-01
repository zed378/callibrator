/**
 * E2E Tests: Network Security module (/api/v1/network-security)
 *
 * Live smoke coverage:
 *  - GET  /network-security/ip-allowlist   — current CIDR allowlist
 *  - PUT  /network-security/ip-allowlist    — replace allowlist (super admin)
 *  - GET  /network-security/geofence        — current geofence config
 *  - PUT  /network-security/geofence        — replace geofence (super admin)
 *  - POST /network-security/evaluate-login  — evaluate an IP/location
 *
 * Tenant context comes from req.user.tenantId (no path param).
 *
 * P10-13: the WRITES go to a disposable tenant through the A-280 routes
 * (/network-security/tenants/:tenantId/...), never to the operator's home
 * (default) tenant. Writing there left an allowlist and a geofence on the
 * default tenant, which A-288 enforces at sign-in, so the NEXT run of the
 * suite failed for reasons unrelated to the code. The geofence has no "clear"
 * route, so restoring it is impossible; the home tenant is only read, and it
 * is checked to carry no allowlist and no geofence before and after.
 */
const { httpGet, httpPost, httpPut, extractToken, authHeader } = require("../setup");

/** The home tenant carries no network policy (A-288 would enforce it at sign-in). */
async function expectHomeTenantUnrestricted(token) {
  const allowlist = await httpGet("/network-security/ip-allowlist", authHeader(token));
  const geofence = await httpGet("/network-security/geofence", authHeader(token));
  expect(allowlist.status).toBe(200);
  expect(geofence.status).toBe(200);
  expect(allowlist.body?.data?.allowlist ?? []).toEqual([]);
  expect(geofence.body?.data?.geofence ?? null).toBeNull();
}
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup");

describe("E2E Network Security (HTTP)", () => {
  let token;
  let scratchTenantId = null;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: OPERATOR_PASSWORD,
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
    const code = "e2ens" + Date.now().toString(36);
    const created = await httpPost("/tenants/create", { name: "E2E NetSec " + code, code, description: "e2e" }, authHeader(token));
    expect(created.status).toBe(201);
    scratchTenantId = created.body.data.id;
  });

  test("the home (default) tenant has no allowlist and no geofence BEFORE the writes", async () => {
    await expectHomeTenantUnrestricted(token);
  });

  afterAll(async () => {
    // Clear what the writes set on the scratch tenant (its geofence cannot be cleared; the tenant is disposable).
    if (scratchTenantId) {
      await httpPut(`/network-security/tenants/${scratchTenantId}/ip-allowlist`, { cidrs: [] }, authHeader(token));
    }
  });

  test("GET /network-security/ip-allowlist — 401 without auth", async () => {
    const { status } = await httpGet("/network-security/ip-allowlist");
    expect(status).toBe(401);
  });

  test("GET /network-security/ip-allowlist — 200", async () => {
    const { status, body } = await httpGet("/network-security/ip-allowlist", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("PUT /network-security/tenants/:id/ip-allowlist — 200 updates CIDRs (a disposable tenant)", async () => {
    const { status, body } = await httpPut(
      `/network-security/tenants/${scratchTenantId}/ip-allowlist`,
      { cidrs: ["10.0.0.0/8", "192.168.1.0/24"] },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
  });

  test("PUT /network-security/ip-allowlist — 400 on malformed CIDR", async () => {
    const { status } = await httpPut(
      "/network-security/ip-allowlist",
      { cidrs: ["not-a-cidr"] },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("GET /network-security/geofence — 200", async () => {
    const { status } = await httpGet("/network-security/geofence", authHeader(token));
    expect(status).toBe(200);
  });

  test("PUT /network-security/tenants/:id/geofence — 200 updates geofence (a disposable tenant)", async () => {
    const { status, body } = await httpPut(
      `/network-security/tenants/${scratchTenantId}/geofence`,
      { latitude: -6.2, longitude: 106.8, radiusKm: 50 },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
  });

  test("POST /network-security/evaluate-login — 200 evaluation result", async () => {
    const { status, body } = await httpPost(
      "/network-security/evaluate-login",
      { ip: "10.0.0.5", latitude: -6.2, longitude: 106.8 },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("POST /network-security/evaluate-login — 400 on invalid ip", async () => {
    const { status } = await httpPost(
      "/network-security/evaluate-login",
      { ip: "999.999.1.1" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("the home (default) tenant still has no allowlist and no geofence AFTER the writes", async () => {
    await expectHomeTenantUnrestricted(token);
  });
});
