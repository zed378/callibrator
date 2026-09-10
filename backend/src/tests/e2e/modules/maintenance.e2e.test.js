/**
 * E2E Tests: Maintenance (work orders) module (LIVE HTTP)
 *
 * Mount: /api/v1/maintenance  (see index.js)
 * Route file: src/routes/api/maintenance.route.js
 *
 * Covered routes:
 *   GET    /maintenance
 *   POST   /maintenance
 *   GET    /maintenance/:orderId
 *   PATCH  /maintenance/:orderId
 *   DELETE /maintenance/:orderId
 *
 * A parent CalibrationDevice is created first (work order FKs deviceId, a NOT
 * NULL column) and cleaned up at the end. Public field `assigneeId` is mapped to
 * the `assignedTo` column by the service.
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
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

describe("E2E Maintenance (HTTP)", () => {
  let token;
  let auth;
  const ids = { device: null, order: null };

  async function login() {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    return extractToken(body);
  }

  beforeAll(async () => {
    token = await login();
    expect(token).toBeTruthy();
    auth = authHeader(token);

    const d = await httpPost(
      "/calibration-devices",
      {
        name: "E2E Maintenance Device",
        manufacturer: "Fluke",
        model: "DM-200",
        serialNumber: `E2E-MNT-${Date.now()}`,
        status: "active",
      },
      auth,
    );
    ids.device = d.body?.data?.id;
  });

  afterAll(async () => {
    if (ids.order) await httpDelete(`/maintenance/${ids.order}`, auth);
    if (ids.device) await httpDelete(`/calibration-devices/${ids.device}`, auth);
  });

  test("GET /maintenance — 200, data array, meta top-level", async () => {
    const { status, body } = await httpGet("/maintenance?page=1&limit=5", auth);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test("POST /maintenance — 201 creates work order", async () => {
    const { status, body } = await httpPost(
      "/maintenance",
      {
        deviceId: ids.device,
        title: "E2E Preventative WO",
        type: "Preventative",
        priority: "Medium",
        description: "e2e scheduled maintenance",
      },
      auth,
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    ids.order = body.data.id;
  });

  test("POST /maintenance — 400 on missing required fields", async () => {
    const { status } = await httpPost(
      "/maintenance",
      { title: "no device or type" },
      auth,
    );
    expect(status).toBe(400);
  });

  test("GET /maintenance/:id — 200 returns work order", async () => {
    const { status, body } = await httpGet(`/maintenance/${ids.order}`, auth);
    expect(status).toBe(200);
    expect(body.data.id).toBe(ids.order);
  });

  test("GET /maintenance/:id — 400 on invalid UUID", async () => {
    const { status } = await httpGet("/maintenance/not-a-uuid", auth);
    expect(status).toBe(400);
  });

  test("PATCH /maintenance/:id — 200 updates status", async () => {
    const { status } = await httpPatch(
      `/maintenance/${ids.order}`,
      { status: "InProgress", description: "work started" },
      auth,
    );
    expect(status).toBe(200);
  });

  test("GET /maintenance — 401 without token", async () => {
    const { status } = await httpGet("/maintenance");
    expect(status).toBe(401);
  });

  test("DELETE /maintenance/:id — 200 deletes work order", async () => {
    const { status } = await httpDelete(`/maintenance/${ids.order}`, auth);
    expect(status).toBe(200);
    ids.order = null;
  });
});
