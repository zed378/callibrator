/**
 * E2E Tests: Vendors module (LIVE HTTP)
 *
 * Mount: /api/v1/vendors  (see index.js)
 * Route file: src/routes/api/vendor.route.js
 *
 * Covered routes:
 *   GET    /vendors
 *   POST   /vendors
 *   GET    /vendors/:vendorId
 *   PATCH  /vendors/:vendorId
 *   PATCH  /vendors/:vendorId/qualify
 *   DELETE /vendors/:vendorId
 *
 * Envelope: { success, status, message, data }; list rows in `data` (array),
 * pagination `meta` as a TOP-LEVEL sibling (vendor.controller maps the service's
 * data.rows -> data and data.meta -> meta).
 */
const {
  httpGet,
  httpPost,
  httpPut,
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

describe("E2E Vendors (HTTP)", () => {
  let token;
  let auth;
  let vendorId;

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
  });

  afterAll(async () => {
    if (vendorId) await httpDelete(`/vendors/${vendorId}`, auth);
  });

  test("GET /vendors — 200, data array, meta top-level", async () => {
    const { status, body } = await httpGet("/vendors?page=1&limit=5", auth);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test("POST /vendors — 201 creates vendor", async () => {
    const { status, body } = await httpPost(
      "/vendors",
      {
        name: "E2E Vendor",
        type: "CalibrationLab",
        contactPerson: "Jane QA",
        email: "vendor@e2e.test",
        phone: "+1-555-0100",
        status: "Active",
      },
      auth,
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    vendorId = body.data.id;
  });

  test("POST /vendors — 400 on missing required name", async () => {
    const { status } = await httpPost("/vendors", { type: "Other" }, auth);
    expect(status).toBe(400);
  });

  test("GET /vendors/:id — 200 returns the vendor", async () => {
    const { status, body } = await httpGet(`/vendors/${vendorId}`, auth);
    expect(status).toBe(200);
    expect(body.data.id).toBe(vendorId);
  });

  test("GET /vendors/:id — 400 on invalid UUID", async () => {
    const { status } = await httpGet("/vendors/not-a-uuid", auth);
    expect(status).toBe(400);
  });

  test("PATCH /vendors/:id — 200 updates vendor", async () => {
    const { status } = await httpPatch(
      `/vendors/${vendorId}`,
      { contactPerson: "John QA", rating: 4 },
      auth,
    );
    expect(status).toBe(200);
  });

  test("PATCH /vendors/:id/qualify — 200 qualifies vendor", async () => {
    const { status } = await httpPatch(
      `/vendors/${vendorId}/qualify`,
      {
        approvalStatus: "Approved",
        scorecard: 88,
        lastAuditDate: "2026-01-15",
        nextAuditDate: "2027-01-15",
      },
      auth,
    );
    expect(status).toBe(200);
  });

  test("GET /vendors — 401 without token", async () => {
    const { status } = await httpGet("/vendors");
    expect(status).toBe(401);
  });

  test("DELETE /vendors/:id — 200 deletes vendor", async () => {
    const { status } = await httpDelete(`/vendors/${vendorId}`, auth);
    expect(status).toBe(200);
    vendorId = null;
  });
});
