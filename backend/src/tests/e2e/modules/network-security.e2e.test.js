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
 */
const { httpGet, httpPost, httpPut, extractToken, authHeader } = require("../setup");

describe("E2E Network Security (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
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

  test("PUT /network-security/ip-allowlist — 200 updates CIDRs", async () => {
    const { status, body } = await httpPut(
      "/network-security/ip-allowlist",
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

  test("PUT /network-security/geofence — 200 updates geofence", async () => {
    const { status, body } = await httpPut(
      "/network-security/geofence",
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
});
