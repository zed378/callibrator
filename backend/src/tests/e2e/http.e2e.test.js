/**
 * E2E Tests: HTTP Protocol, Error Handling & Resilience
 *
 * Tests the API server's HTTP behavior through real requests:
 * - Content-Type validation
 * - Error response structure consistency
 * - XSS sanitization
 * - Oversized payload handling
 * - Malformed JSON handling
 * - Response time thresholds
 * - Concurrent request resilience
 *
 * NOTE: Express 5 returns 404 (not 405) for wrong methods on routes.
 * Error body format: { success: false, status: N, message: "...", data: null }
 */
const {
  httpPost,
  httpGet,
  API_BASE,
} = require("./setup");

// A-185: failed sign-ins are throttled per identifier and address (five per
// fifteen minutes, an unknown identifier exactly like a real one). A fixed
// address here would be paused by a second run inside that window; each run
// uses its own.
// P6-02: under example.com — `.invalid` is reserved but not an IANA TLD, so
// the login schema's email() refused it with a 400 and the 401 path was never
// reached.
const UNKNOWN_EMAIL = `nobody-${Date.now()}@e2e.example.com`;

describe("E2E HTTP Protocol & Error Handling (HTTP)", () => {
  // ─── 1. CONTENT TYPES ──────────────────────────────────────

  test("All /api/v1 routes return application/json content-type", async () => {
    const testPaths = [
      "/auth/register",
      "/auth/login",
      "/auth/verify",
      "/user",
      "/roles",
      "/calibration-devices",
      "/warehouses",
      "/certificates",
    ];

    for (const path of testPaths) {
      const { headers } = await httpGet(path);
      expect(headers["content-type"]).toContain("application/json");
    }
  });

  // ─── 2. ERROR RESPONSE STRUCTURE CONSISTENCY ───────────────

  test("Validation error returns { status, message }", async () => {
    // P10-13: /auth/register is absent in production (P10-12, Q-44), so the
    // validation envelope is checked on a route every mode has.
    // No request budget on this route (the reset routes have one, ADR-100).
    const { status, body } = await httpPost("/auth/first-sign-in/password", {});
    expect(status).toBe(400);
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("message");
    expect(body.success).toBe(false);
  });

  test("Auth error returns { status, message }", async () => {
    const { status, body } = await httpPost("/auth/login", {
      email: UNKNOWN_EMAIL,
      password: "wrong",
    });
    expect(status).toBe(401);
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("message");
    expect(body.message).toContain("Invalid");
  });

  test("Not found returns JSON with message", async () => {
    const { status, body } = await httpGet("/nonexistent/path");
    expect(status).toBe(404);
    expect(body).toHaveProperty("message");
  });

  // ─── 3. INPUT SANITIZATION (XSS) ───────────────────────────

  // P10-13: /auth/register is absent in production (P10-12, Q-44); the public
  // intake that replaced it takes the payload instead.
  test("XSS payload in the public access-request intake handled gracefully", async () => {
    const { status } = await httpPost("/access-requests", {
      organisationName: "<script>alert('xss')</script> RS",
      facilityType: "hospital",
      city: "Bandung",
      deviceCountBand: "unknown",
      contactName: "Xss Test",
      workEmail: `xss-${Date.now()}@example.com`,
      whatsapp: "081234567890",
      consent: true,
      consentVersion: "2026-09-29",
      locale: "en",
    }, {
      // Its own client address: the production intake budget is 5 an hour per
      // address (ADR-100), and the browser suite submits from the shared one.
      "X-Forwarded-For": `198.19.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`,
    });

    // Either rejected (400) or accepted with the neutral answer (stored as text, escaped where shown)
    expect([202, 400]).toContain(status);
  });

  // ─── 4. OVERSIZED PAYLOAD ──────────────────────────────────

  test("POST /auth/login — oversized email handled gracefully", async () => {
    const oversizedEmail = "a".repeat(50000) + "@test.com";
    const { status } = await httpPost("/auth/login", {
      email: oversizedEmail,
      password: "TestPass123",
    });

    // Should be 400 (validation) or 413 (too large)
    expect([400, 413, 414]).toContain(status);
  });

  // ─── 5. RESPONSE TIMES ─────────────────────────────────────

  test("POST /auth/login — responds within 5 seconds", async () => {
    const start = Date.now();
    const { status, elapsed } = await httpPost("/auth/login", {
      email: UNKNOWN_EMAIL,
      password: "wrong",
    });

    expect(status).toBe(401);
    expect(elapsed).toBeLessThan(5000);
  });

  test("GET endpoints respond within 2 seconds", async () => {
    const paths = ["/auth/verify", "/roles", "/warehouses"];
    for (const path of paths) {
      const start = Date.now();
      const { status } = await httpGet(path);
      const elapsed = Date.now() - start;

      expect([401, 404]).toContain(status);
      expect(elapsed).toBeLessThan(2000);
    }
  });

  // ─── 6. MALFORMED JSON — via native fetch ──────────────────

  test("POST /auth/login — malformed JSON returns 400", async () => {
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid json}",
      signal: AbortSignal.timeout(5000),
    });

    expect(resp.status).toBe(400);
    expect(resp.headers.get("content-type")).toContain("application/json");
  });

  // ─── 7. TRAILING SLASH — graceful handling ─────────────────

  test("GET /auth/ — not 200", async () => {
    const { status } = await httpGet("/auth/");
    expect(status).not.toBe(200);
    expect([301, 404]).toContain(status);
  });

  // ─── 8. CONCURRENT REQUESTS ────────────────────────────────

  test("Multiple concurrent requests don't crash the server", async () => {
    const promises = Array.from({ length: 10 }, () =>
      httpGet("/auth/login").catch(() => null),
    );

    const results = await Promise.all(promises);
    // All should return a valid response (no crashes)
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result.status).toBeDefined();
      expect(result.body).toBeDefined();
    }
  });

  // ─── 9. RATE LIMIT HEADERS ─────────────────────────────────

  test("POST /auth/login includes rate limit headers", async () => {
    const { headers } = await httpPost("/auth/login", {
      email: UNKNOWN_EMAIL,
      password: "wrong",
    });

    // express-rate-limit adds these headers
    const hasRateLimit =
      headers["ratelimit-limit"] ||
      headers["x-ratelimit-limit"] ||
      headers["ratelimit-remaining"];

    // Should have rate limiting (the login endpoint is rate limited)
    expect(hasRateLimit).toBeTruthy();
  });

  // ─── 10. COMPRESSION ───────────────────────────────────────

  test("Response accepts gzip encoding", async () => {
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: "GET",
      headers: { "Accept-Encoding": "gzip, deflate" },
      signal: AbortSignal.timeout(3000),
    });
    // Should not crash; status may be 404 or 405
    expect([404, 405]).toContain(resp.status);
  });

  // ─── 11. REQUEST ID HEADER ─────────────────────────────────

  test("Responses include X-Request-ID for tracing", async () => {
    const { headers } = await httpGet("/user");
    expect(headers["x-request-id"]).toBeDefined();
  });

  // ─── 12. STRICT TRANSPORT SECURITY ─────────────────────────

  test("Responses include HSTS header", async () => {
    const { headers } = await httpGet("/user");
    expect(headers["strict-transport-security"]).toBeDefined();
  });
});
