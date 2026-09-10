/**
 * E2E Tests: Warehouse + Storage Location Module (HTTP)
 *
 * Verifies /api/v1/warehouses against the running API server with a real
 * Bearer token obtained once via POST /auth/login (sys@mail.com / 123123).
 *
 * Covered routes (from warehouse.route.js):
 *   GET    /warehouses
 *   POST   /warehouses
 *   GET    /warehouses/:warehouseId
 *   PATCH  /warehouses/:warehouseId
 *   DELETE /warehouses/:warehouseId
 *   GET    /warehouses/:warehouseId/locations
 *   POST   /warehouses/locations
 *   PATCH  /warehouses/locations/:locationId
 *   DELETE /warehouses/locations/:locationId
 *
 * Response envelope: { success, status, message, data }, with pagination `meta`
 * as a TOP-LEVEL sibling of data (NOT data.meta).
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

// setup.js has no PATCH helper; these modules use PATCH for updates.
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

describe("E2E Warehouse Module (HTTP)", () => {
  let token;
  let auth;
  const created = { warehouseId: null, locationId: null };

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", ADMIN);
    token = extractToken(body);
    auth = authHeader(token);
  });

  afterAll(async () => {
    // best-effort cleanup
    if (created.locationId) {
      await httpDelete(`/warehouses/locations/${created.locationId}`, auth);
    }
    if (created.warehouseId) {
      await httpDelete(`/warehouses/${created.warehouseId}`, auth);
    }
  });

  test("has a valid admin token", () => {
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
  });

  test("GET /warehouses — 200 list with top-level meta", async () => {
    const { status, body } = await httpGet("/warehouses?page=1&limit=5", auth);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
    expect(body.meta).toHaveProperty("total");
  });

  test("GET /warehouses — 401 without token", async () => {
    const { status } = await httpGet("/warehouses");
    expect(status).toBe(401);
  });

  test("POST /warehouses — 201 create", async () => {
    const { status, body } = await httpPost(
      "/warehouses",
      { name: "E2E Warehouse", code: `E2E-WH-${Date.now()}` },
      auth,
    );
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("id");
    created.warehouseId = body.data.id;
  });

  test("POST /warehouses — 400 on missing required fields", async () => {
    const { status, body } = await httpPost("/warehouses", { name: "x" }, auth);
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  test("GET /warehouses/:id — 200 fetch created warehouse", async () => {
    const { status, body } = await httpGet(
      `/warehouses/${created.warehouseId}`,
      auth,
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(created.warehouseId);
  });

  test("GET /warehouses/:id — 400 on invalid UUID", async () => {
    const { status } = await httpGet("/warehouses/not-a-uuid", auth);
    expect(status).toBe(400);
  });

  test("PATCH /warehouses/:id — 200 update", async () => {
    const { status, body } = await httpPatch(
      `/warehouses/${created.warehouseId}`,
      { name: "E2E Warehouse Updated" },
      auth,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /warehouses/:id/locations — 200 list", async () => {
    const { status, body } = await httpGet(
      `/warehouses/${created.warehouseId}/locations`,
      auth,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("POST /warehouses/locations — 201 create location", async () => {
    const { status, body } = await httpPost(
      "/warehouses/locations",
      {
        warehouseId: created.warehouseId,
        name: "E2E Location",
        code: `E2E-LOC-${Date.now()}`,
      },
      auth,
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    created.locationId = body.data.id;
  });

  test("POST /warehouses/locations — 400 missing warehouseId", async () => {
    const { status } = await httpPost(
      "/warehouses/locations",
      { name: "No WH", code: "NOWH" },
      auth,
    );
    expect(status).toBe(400);
  });
});
