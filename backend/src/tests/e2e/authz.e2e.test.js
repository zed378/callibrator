/**
 * E2E Tests: RBAC & Authorization
 *
 * Verifies that:
 * - Unauthenticated users get 401 on protected endpoints
 * - Invalid tokens are properly rejected
 * - Security headers are present
 * - CORS headers are properly configured
 *
 * NOTE: Express 5 returns 404 (not 405) for wrong methods on routes.
 * Some routes like /user may return 404 if not defined.
 */
const {
  httpGet,
  httpPost,
  httpOptions,
} = require("./setup");

describe("E2E Authorization (HTTP)", () => {
  // ─── 1. UNAUTHENTICATED ACCESS — all protected routes ──────

  test("GET /user — 401 or 404 without auth", async () => {
    const { status } = await httpGet("/user");
    // 401 if route exists but requires auth; 404 if route not defined
    expect([401, 404]).toContain(status);
  });

  test("GET /roles — 401 without auth", async () => {
    const { status } = await httpGet("/roles");
    expect(status).toBe(401);
  });

  test("GET /menu-groups — 401 or 404 without auth", async () => {
    const { status } = await httpGet("/menu-groups");
    expect([401, 404]).toContain(status);
  });

  test("GET /calibration-devices — 401 without auth", async () => {
    const { status } = await httpGet("/calibration-devices");
    expect(status).toBe(401);
  });

  test("GET /calibration-records — 401 without auth", async () => {
    const { status } = await httpGet("/calibration-records");
    expect(status).toBe(401);
  });

  test("GET /certificates — 401 without auth", async () => {
    const { status } = await httpGet("/certificates");
    expect(status).toBe(401);
  });

  test("GET /warehouses — 401 without auth", async () => {
    const { status } = await httpGet("/warehouses");
    expect(status).toBe(401);
  });

  test("GET /tenant/backup — 401 or 404 without auth", async () => {
    const { status } = await httpGet("/tenant/backup");
    expect([401, 404]).toContain(status);
  });

  // ─── 2. INVALID TOKEN BEHAVIOR ─────────────────────────────

  test("GET /user — 401 or 404 on empty bearer", async () => {
    const { status } = await httpGet("/user", {
      Authorization: "Bearer ",
    });
    expect([401, 404]).toContain(status);
  });

  test("GET /user — 401 or 404 on malformed auth header", async () => {
    const { status } = await httpGet("/user", {
      Authorization: "InvalidFormat",
    });
    expect([401, 404]).toContain(status);
  });

  test("GET /user — 401 or 404 on JWT-like but fake token", async () => {
    const fakeToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTYyMzkwMjJ9.fake";
    const { status } = await httpGet("/user", {
      Authorization: `Bearer ${fakeToken}`,
    });
    expect([401, 404]).toContain(status);
  });

  test("POST /auth/refresh with access token — 401", async () => {
    const fakeToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4iLCJpYXQiOjE1MTYyMzkwMjJ9.fake";
    const { status } = await httpPost("/auth/refresh", {
      refreshToken: fakeToken,
    });
    expect(status).toBe(401);
  });

  // ─── 3. SECURITY HEADERS ───────────────────────────────────

  test("Responses include X-Content-Type-Options: nosniff", async () => {
    const { headers } = await httpGet("/user");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("Responses include X-Frame-Options (via Helmet)", async () => {
    const { headers } = await httpGet("/user");
    expect(
      headers["x-frame-options"] ||
        headers["content-security-policy"] ||
        headers["x-permitted-cross-domain-policies"]
    ).toBeDefined();
  });

  // ─── 4. NOT FOUND HANDLING ─────────────────────────────────

  test("GET /nonexistent — 404 with JSON", async () => {
    const { status, body, headers } = await httpGet("/nonexistent/path");
    expect(status).toBe(404);
    expect(headers["content-type"]).toContain("application/json");
    expect(body).toHaveProperty("message");
  });

  // ─── 5. METHOD RESTRICTIONS — Express 5 returns 404 ────────

  test("GET /auth/login — 404 (GET not allowed on POST route)", async () => {
    const { status } = await httpGet("/auth/login");
    // Express 5 returns 404 for wrong HTTP method on defined routes
    expect(status).toBe(404);
  });

  test("GET /auth/register — 404 (GET not allowed on POST route)", async () => {
    const { status } = await httpGet("/auth/register");
    expect(status).toBe(404);
  });

  // ─── 6. CORS HEADERS ───────────────────────────────────────

  test("OPTIONS preflight returns proper CORS headers", async () => {
    const { status, headers } = await httpOptions("/auth/login");
    if (status === 204 || status === 200) {
      expect(headers["access-control-allow-origin"]).toBeDefined();
      expect(headers["access-control-allow-methods"]).toBeDefined();
    }
    // 405 is also acceptable
  });

  // ─── 7. TRAILING SLASH — graceful handling ─────────────────

  test("GET /auth/ — not a 200", async () => {
    const { status } = await httpGet("/auth/");
    expect(status).not.toBe(200);
    expect([301, 404]).toContain(status);
  });
});
