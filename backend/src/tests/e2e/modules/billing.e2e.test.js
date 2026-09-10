/**
 * E2E Tests: Billing module (/api/v1/billing)
 *
 * Live smoke coverage for:
 *  - GET  /billing/subscription
 *  - GET  /billing/invoices        (paginated → top-level meta)
 *  - PATCH /billing/subscription
 *
 * Envelope: { success, status, message, data } with pagination `meta` as a
 * TOP-LEVEL sibling of `data` on list endpoints.
 */
const { httpGet, httpPost, httpPut, extractToken, authHeader } = require("../setup");

describe("E2E Billing (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /billing/subscription — 200 with data object", async () => {
    const { status, body } = await httpGet("/billing/subscription", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("data");
  });

  test("GET /billing/invoices — 200 with array data and top-level meta", async () => {
    const { status, body } = await httpGet("/billing/invoices", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("PATCH /billing/subscription — 200 updates billing cycle", async () => {
    // httpPut used as PATCH shim not available; use raw fetch via httpPut is PUT.
    // The route is PATCH, so exercise via a direct helper below.
    const { status } = await patch("/billing/subscription", { billingCycle: "Monthly" }, token);
    expect([200, 404]).toContain(status); // 404 only if tenant has no subscription row
  });
});

// Minimal PATCH helper (setup.js exposes GET/POST/PUT/DELETE only).
async function patch(path, data, token) {
  const { BASE_URL = "http://localhost:5000" } = process.env;
  const resp = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  let body = null;
  if ((resp.headers.get("content-type") || "").includes("application/json")) {
    body = await resp.json().catch(() => null);
  }
  return { status: resp.status, body };
}
