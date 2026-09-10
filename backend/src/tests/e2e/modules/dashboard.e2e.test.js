/**
 * E2E Tests: Dashboard — /api/v1/dashboard
 *
 * Aggregated metrics. Non-superadmin gets tenant-scoped metrics; SUPERADMIN
 * gets global metrics with a per-tenant breakdown and may scope via ?tenantId.
 */
const { httpGet, httpPost, authHeader } = require("../setup");

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E Dashboard (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /dashboard/metrics — returns metrics object", async () => {
    const { status, body } = await httpGet("/dashboard/metrics", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data).toBe("object");
  });

  test("GET /dashboard/metrics — 401 without token", async () => {
    const { status } = await httpGet("/dashboard/metrics");
    expect(status).toBe(401);
  });
});
