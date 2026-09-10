/**
 * E2E Tests: Finance module (/api/v1/finance)
 *
 * Live smoke coverage for asset finance CRUD + depreciation report:
 *  - GET    /finance                     (paginated → top-level meta)
 *  - GET    /finance/reports/depreciation
 *  - POST   /finance                     (requires a real deviceId FK)
 *  - GET    /finance/:financeId
 *  - PATCH  /finance/:financeId
 *  - DELETE /finance/:financeId
 *
 * A calibration device is created first to satisfy the deviceId FK, then
 * cleaned up at the end.
 */
const { httpGet, httpPost, httpDelete, extractToken, authHeader } = require("../setup");

async function patch(path, data, token) {
  const { BASE_URL = "http://localhost:5000" } = process.env;
  const resp = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  let body = null;
  if ((resp.headers.get("content-type") || "").includes("application/json")) {
    body = await resp.json().catch(() => null);
  }
  return { status: resp.status, body };
}

describe("E2E Finance (HTTP)", () => {
  let token;
  let deviceId;
  let financeId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();

    const dev = await httpPost(
      "/calibration-devices",
      { name: "E2E Finance Device", status: "active" },
      authHeader(token),
    );
    deviceId = dev.body?.data?.id;
  });

  afterAll(async () => {
    if (financeId) await httpDelete(`/finance/${financeId}`, authHeader(token));
    if (deviceId) await httpDelete(`/calibration-devices/${deviceId}`, authHeader(token));
  });

  test("GET /finance — 200 with array data and top-level meta", async () => {
    const { status, body } = await httpGet("/finance", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("GET /finance/reports/depreciation — 200 with data object", async () => {
    const { status, body } = await httpGet(
      "/finance/reports/depreciation",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("POST /finance — 201 creates an asset finance record", async () => {
    expect(deviceId).toBeTruthy();
    const { status, body } = await httpPost(
      "/finance",
      {
        deviceId,
        purchasePrice: 10000,
        purchaseDate: "2025-01-15",
        usefulLifeYears: 5,
        depreciationMethod: "straight_line",
        salvageValue: 1000,
      },
      authHeader(token),
    );
    expect(status).toBe(201);
    financeId = body?.data?.id;
    expect(financeId).toBeTruthy();
  });

  test("GET /finance/:id — 200 retrieves the record", async () => {
    const { status, body } = await httpGet(`/finance/${financeId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body.data).toHaveProperty("id", financeId);
  });

  test("PATCH /finance/:id — 200 updates the record", async () => {
    const { status } = await patch(
      `/finance/${financeId}`,
      { notes: "e2e update", purchasePrice: 12000 },
      token,
    );
    expect(status).toBe(200);
  });

  test("DELETE /finance/:id — 200 soft-deletes the record", async () => {
    const { status } = await httpDelete(`/finance/${financeId}`, authHeader(token));
    expect(status).toBe(200);
    financeId = null; // already removed
  });
});
