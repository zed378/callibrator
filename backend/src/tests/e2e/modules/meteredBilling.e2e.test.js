/**
 * E2E Tests: Metered Billing module (/api/v1/metered-billing)
 *
 * Live smoke coverage:
 *  - GET    /metered-billing/usage
 *  - GET    /metered-billing/plan
 *  - GET    /metered-billing/history
 *  - GET    /metered-billing/alerts
 *  - GET    /metered-billing/analytics
 *  - POST   /metered-billing/estimate
 *  - POST   /metered-billing/alerts
 *  - DELETE /metered-billing/alerts/:alertId
 *
 * Guarded by rbac(["TENANT_ADMIN","BILLING_ADMIN"]); the seeded super-admin
 * passes the guard.
 */
const { httpGet, httpPost, httpDelete, extractToken, authHeader } = require("../setup");

describe("E2E Metered Billing (HTTP)", () => {
  let token;
  let alertId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    if (alertId) await httpDelete(`/metered-billing/alerts/${alertId}`, authHeader(token));
  });

  test("GET /metered-billing/usage — 200", async () => {
    const { status, body } = await httpGet("/metered-billing/usage", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("GET /metered-billing/plan — 200", async () => {
    const { status } = await httpGet("/metered-billing/plan", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /metered-billing/history — 200", async () => {
    const { status } = await httpGet("/metered-billing/history", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /metered-billing/alerts — 200 with array data", async () => {
    const { status, body } = await httpGet("/metered-billing/alerts", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /metered-billing/analytics — 200", async () => {
    const { status } = await httpGet("/metered-billing/analytics", authHeader(token));
    expect(status).toBe(200);
  });

  test("POST /metered-billing/estimate — 200 returns a cost estimate", async () => {
    const { status, body } = await httpPost(
      "/metered-billing/estimate",
      { metrics: { apiCalls: 1000 }, quantity: 1000, period: "monthly" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("POST /metered-billing/alerts — 201 creates an alert", async () => {
    const { status, body } = await httpPost(
      "/metered-billing/alerts",
      { metricName: "apiCalls", threshold: 5000, comparison: "gte" },
      authHeader(token),
    );
    expect(status).toBe(201);
    alertId = body?.data?.id || body?.data?.alert?.id;
    expect(alertId).toBeTruthy();
  });

  test("DELETE /metered-billing/alerts/:id — 200 removes the alert", async () => {
    const { status } = await httpDelete(
      `/metered-billing/alerts/${alertId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    alertId = null; // already removed
  });
});
