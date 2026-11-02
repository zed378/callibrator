/**
 * E2E Tests: Dashboard — /api/v1/dashboard
 *
 * Aggregated metrics. Non-superadmin gets tenant-scoped metrics; SUPERADMIN
 * gets global metrics with a per-tenant breakdown and may scope via ?tenantId.
 */
const { httpGet, httpPost, authHeader } = require("../setup") as any;
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup") as any;

let token: any = undefined;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: OPERATOR_PASSWORD });
  token = (body as any).token || ((body as any).data && (body as any).data.token);
  return token;
}

describe("E2E Dashboard (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /dashboard/metrics — returns metrics object", async () => {
    const { status, body } = await httpGet("/dashboard/metrics", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
    expect(typeof (body as any).data).toBe("object");
  });

  test("GET /dashboard/metrics — 401 without token", async () => {
    const { status } = await httpGet("/dashboard/metrics");
    expect(status).toBe(401);
  });
});
