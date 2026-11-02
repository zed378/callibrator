/**
 * E2E Tests: Reports — /api/v1/reports
 *
 * Tenant-scoped analytics rollups. Each endpoint returns a single report
 * object in `data` (no pagination meta). CSV variants are available via
 * ?format=csv on compliance/overdue-devices/inventory.
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

describe("E2E Reports (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /reports/summary — dashboard rollup", async () => {
    const { status, body } = await httpGet("/reports/summary", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
    expect(typeof (body as any).data).toBe("object");
  });

  test("GET /reports/compliance — compliance rate", async () => {
    const { status, body } = await httpGet("/reports/compliance", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("GET /reports/calibration-workload — work orders breakdown", async () => {
    const { status, body } = await httpGet("/reports/calibration-workload", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("GET /reports/overdue-devices — overdue devices", async () => {
    const { status, body } = await httpGet("/reports/overdue-devices", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("GET /reports/inventory — inventory + low stock", async () => {
    const { status, body } = await httpGet("/reports/inventory", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("GET /reports/summary — 401 without token", async () => {
    const { status } = await httpGet("/reports/summary");
    expect(status).toBe(401);
  });
});
