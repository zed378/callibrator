/**
 * E2E Tests: Reports — /api/v1/reports
 *
 * Tenant-scoped analytics rollups. Each endpoint returns a single report
 * object in `data` (no pagination meta). CSV variants are available via
 * ?format=csv on compliance/overdue-devices/inventory.
 */
const { httpGet, httpPost, authHeader } = require("../setup");

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E Reports (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /reports/summary — dashboard rollup", async () => {
    const { status, body } = await httpGet("/reports/summary", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data).toBe("object");
  });

  test("GET /reports/compliance — compliance rate", async () => {
    const { status, body } = await httpGet("/reports/compliance", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /reports/calibration-workload — work orders breakdown", async () => {
    const { status, body } = await httpGet("/reports/calibration-workload", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /reports/overdue-devices — overdue devices", async () => {
    const { status, body } = await httpGet("/reports/overdue-devices", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /reports/inventory — inventory + low stock", async () => {
    const { status, body } = await httpGet("/reports/inventory", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /reports/summary — 401 without token", async () => {
    const { status } = await httpGet("/reports/summary");
    expect(status).toBe(401);
  });
});
