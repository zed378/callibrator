/**
 * E2E Tests: Audit & Compliance (/api/v1/audit) — FDA 21 CFR Part 11
 *
 * Live smoke against the running server. Logs in once as the seeded
 * super-admin and reuses the access token. The single GET endpoint is gated by
 * dynamicAccess(["AuditLogs","Audit Logs","audit"], "read") — the super-admin
 * passes. Response follows the house envelope (data = array, meta = sibling).
 */
const {
  httpGet,
  httpPost,
  authHeader,
  extractToken,
  waitForServer,
} = require("../setup");

describe("E2E Audit (HTTP)", () => {
  let token;

  beforeAll(async () => {
    await waitForServer();
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /audit — 200, envelope: data array + meta sibling", async () => {
    const { status, body } = await httpGet("/audit?limit=5", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
    expect(body.meta).toHaveProperty("total");
    expect(body.meta).toHaveProperty("page");
  });

  test("GET /audit — accepts filter params without error", async () => {
    const { status, body } = await httpGet(
      "/audit?action=LOGIN&page=1&limit=10",
      authHeader(token)
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /audit — 401 without auth", async () => {
    const { status } = await httpGet("/audit");
    expect(status).toBe(401);
  });
});
