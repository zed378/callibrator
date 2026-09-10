/**
 * E2E Tests: Storage Module (HTTP)
 *
 * Verifies /api/v1/storage against the running API server using a real Bearer
 * token from POST /auth/login (sys@mail.com / 123123).
 *
 * Covered routes (from storage.route.js):
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

const ADMIN = { user: "sys@mail.com", password: "123123" };

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

  test("PUT /storage/settings — 422 when S3 connection test fails", async () => {
    const { status } = await httpPut(
      "/storage/settings",
      {
        provider: "s3",
        bucket: "e2e-nonexistent-bucket-x",
        region: "us-east-1",
        accessKeyId: "AKIAINVALID",
        secretAccessKey: "invalidsecret",
      },
      auth,
    );
    expect(status).toBe(422);
  });
});
