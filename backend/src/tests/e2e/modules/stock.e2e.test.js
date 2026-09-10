/**
 * E2E Tests: Stock / Inventory Module (HTTP)
 *
 * Verifies /api/v1/stocks against the running API server using a real Bearer
 * token from POST /auth/login (sys@mail.com / 123123). A parent warehouse is
 * created first (stock FKs a warehouseId) and cleaned up at the end.
 *
 * Covered routes (from stock.route.js):
 *   GET    /stocks
 *   POST   /stocks
 *   GET    /stocks/:stockId
 *   PATCH  /stocks/:stockId
 *   DELETE /stocks/:stockId
 *   POST   /stocks/adjustment
 *   GET    /stocks/adjustment/history
 *   POST   /stocks/transfer
 *   GET    /stocks/transfer/history
 *   POST   /stocks/opname
 *   PATCH  /stocks/opname/:opnameId
 *   GET    /stocks/opname/history
 *   GET    /stocks/reports/summary
 *   GET    /stocks/reports/export   (text/csv)
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  extractToken,
  authHeader,
  API_BASE,
  defaultHeaders,
} = require("../setup");

async function httpPatch(path, data = {}, headers = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const ct = resp.headers.get("content-type") || "";
  const body = ct.includes("application/json")
    ? await resp.json().catch(() => null)
    : null;
  return { status: resp.status, body };
}

const ADMIN = { user: "sys@mail.com", password: "123123" };

describe("E2E Stock Module (HTTP)", () => {
  let token;
  let auth;
  const ids = { wh1: null, wh2: null, stock: null, opname: null };

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", ADMIN);
    token = extractToken(body);
    auth = authHeader(token);

    const w1 = await httpPost(
      "/warehouses",
      { name: "E2E Stock WH1", code: `E2E-SWH1-${Date.now()}` },
      auth,
    );
    ids.wh1 = w1.body?.data?.id;
    const w2 = await httpPost(
      "/warehouses",
      { name: "E2E Stock WH2", code: `E2E-SWH2-${Date.now()}` },
      auth,
    );
    ids.wh2 = w2.body?.data?.id;
  });

  afterAll(async () => {
    if (ids.stock) await httpDelete(`/stocks/${ids.stock}`, auth);
    if (ids.wh1) await httpDelete(`/warehouses/${ids.wh1}`, auth);
    if (ids.wh2) await httpDelete(`/warehouses/${ids.wh2}`, auth);
  });

  test("GET /stocks — 200 list with top-level meta", async () => {
    const { status, body } = await httpGet("/stocks?page=1&limit=5", auth);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("POST /stocks — 201 create", async () => {
    const { status, body } = await httpPost(
      "/stocks",
      {
        warehouseId: ids.wh1,
        itemName: "E2E Widget",
        sku: "E2E-SKU-1",
        quantity: 100,
        minQuantity: 5,
      },
      auth,
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    ids.stock = body.data.id;
  });

  test("POST /stocks — 400 on missing required fields", async () => {
    const { status } = await httpPost("/stocks", { quantity: 1 }, auth);
    expect(status).toBe(400);
  });

  test("GET /stocks/:id — 200 fetch", async () => {
    const { status, body } = await httpGet(`/stocks/${ids.stock}`, auth);
    expect(status).toBe(200);
    expect(body.data.id).toBe(ids.stock);
  });

  test("PATCH /stocks/:id — 200 update quantity", async () => {
    const { status } = await httpPatch(
      `/stocks/${ids.stock}`,
      { quantity: 120 },
      auth,
    );
    expect(status).toBe(200);
  });

  test("POST /stocks/adjustment — 201", async () => {
    const { status } = await httpPost(
      "/stocks/adjustment",
      { stockId: ids.stock, type: "addition", quantity: 10, reason: "e2e received batch" },
      auth,
    );
    expect(status).toBe(201);
  });

  test("GET /stocks/adjustment/history — 200", async () => {
    const { status, body } = await httpGet(
      "/stocks/adjustment/history?page=1&limit=5",
      auth,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("POST /stocks/transfer — 201", async () => {
    const { status } = await httpPost(
      "/stocks/transfer",
      {
        fromWarehouseId: ids.wh1,
        toWarehouseId: ids.wh2,
        itemName: "E2E Widget",
        quantity: 5,
        notes: "e2e rebalance",
      },
      auth,
    );
    expect(status).toBe(201);
  });

  test("GET /stocks/transfer/history — 200", async () => {
    const { status } = await httpGet(
      "/stocks/transfer/history?page=1&limit=5",
      auth,
    );
    expect(status).toBe(200);
  });

  test("POST /stocks/opname — 201 schedule", async () => {
    const { status, body } = await httpPost(
      "/stocks/opname",
      {
        warehouseId: ids.wh1,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        notes: "e2e cycle count",
      },
      auth,
    );
    expect(status).toBe(201);
    ids.opname = body.data?.id;
  });

  test("PATCH /stocks/opname/:id — 200 status update", async () => {
    const { status } = await httpPatch(
      `/stocks/opname/${ids.opname}`,
      { status: "in_progress" },
      auth,
    );
    expect(status).toBe(200);
  });

  test("GET /stocks/opname/history — 200", async () => {
    const { status } = await httpGet(
      "/stocks/opname/history?page=1&limit=5",
      auth,
    );
    expect(status).toBe(200);
  });

  test("GET /stocks/reports/summary — 200", async () => {
    const { status, body } = await httpGet("/stocks/reports/summary", auth);
    expect(status).toBe(200);
    expect(body.data).toHaveProperty("totalItems");
  });

  test("GET /stocks/reports/export — 200 CSV", async () => {
    const resp = await fetch(`${API_BASE}/stocks/reports/export`, {
      headers: { ...defaultHeaders, ...auth },
      signal: AbortSignal.timeout(15000),
    });
    expect(resp.status).toBe(200);
    const ct = resp.headers.get("content-type") || "";
    expect(ct).toContain("csv");
  });
});
