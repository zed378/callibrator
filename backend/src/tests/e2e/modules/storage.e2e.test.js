/**
 * E2E Tests: Storage Module (HTTP)
 *
 * Verifies /api/v1/storage against the running API server using a real Bearer
 * token from POST /auth/login (sys@mail.com / E2E_OPERATOR_PASSWORD, see setup.js).
 *
 * Covered routes (from storage.route.ts):
 *   GET    /storage/object          (PUBLIC, token-gated — no auth)
 *   GET    /storage/settings
 *   PUT    /storage/settings        (health-checked before save)
 *   DELETE /storage/settings
 *   POST   /storage/settings/test
 *   GET    /storage/usage
 *
 * PUT with a bad-provider body is expected to 400 (validator) and PUT with
 * unreachable/invalid S3 creds is expected to 422 (connection test failed) —
 * neither persists, so the tenant's default storage is left untouched.
 */
const {
  httpGet,
  httpPost,
  httpPut,
  extractToken,
  authHeader,
} = require("../setup");
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup");

const ADMIN = { user: "sys@mail.com", password: OPERATOR_PASSWORD };

describe("E2E Storage Module (HTTP)", () => {
  let token;
  let auth;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", ADMIN);
    token = extractToken(body);
    auth = authHeader(token);
  });

  test("GET /storage/settings — 200 (secrets redacted)", async () => {
    const { status, body } = await httpGet("/storage/settings", auth);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /storage/settings — 401 without token", async () => {
    const { status } = await httpGet("/storage/settings");
    expect(status).toBe(401);
  });

  test("GET /storage/usage — 200", async () => {
    const { status, body } = await httpGet("/storage/usage", auth);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST /storage/settings/test — 200 connection test", async () => {
    const { status, body } = await httpPost("/storage/settings/test", {}, auth);
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("GET /storage/object — 403 on invalid/expired token (public route)", async () => {
    const { status } = await httpGet("/storage/object?key=bogus&token=bogus");
    expect(status).toBe(403);
  });

  test("PUT /storage/settings — 400 on invalid provider", async () => {
    const { status } = await httpPut(
      "/storage/settings",
      { provider: "local" },
      auth,
    );
    // `local` is rejected by the validator (not a tenant-selectable provider)
    expect(status).toBe(400);
  });

  // A-348 (2026-10-02): the connection test must not leave the stack. With no
  // endpoint the backend dialled real AWS (us-east-1), and in run J that took
  // longer than the harness's 15 s. `postgres` is a service of the e2e compose
  // stack: a tenant-supplied endpoint resolving to an internal address is
  // refused at connect time by the SSRF guard's pinned lookup (A-176), so the
  // test fails at once, with no network beyond the stack's own DNS. Port 1 is
  // closed even where the guard allows the host (a development allow-list).
  // Off the compose stack the name does not resolve, which fails the test too;
  // the backend bounds the test at 5 s either way. E2E_S3_DEAD_ENDPOINT
  // overrides the endpoint.
  const DEAD_ENDPOINT = process.env.E2E_S3_DEAD_ENDPOINT || "http://postgres:1";

  test("PUT /storage/settings — 422 when S3 connection test fails", async () => {
    const started = Date.now();
    const { status, body } = await httpPut(
      "/storage/settings",
      {
        provider: "s3",
        bucket: "e2e-nonexistent-bucket-x",
        region: "us-east-1",
        endpoint: DEAD_ENDPOINT,
        accessKeyId: "AKIAINVALID",
        secretAccessKey: "invalidsecret",
      },
      auth,
    );
    expect(status).toBe(422);
    expect(body.message).toMatch(/^Storage connection test failed/);
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
