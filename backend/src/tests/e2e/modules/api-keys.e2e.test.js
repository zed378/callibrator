/**
 * E2E Tests: API Keys — /api/v1/api-keys
 *
 * Tenant-scoped service accounts. Management is JWT-only (denyApiKey) and gated
 * by the "api_keys" plan feature; SUPER_ADMIN bypasses the feature gate. The
 * plaintext key is returned exactly once on create.
 */
const { httpGet, httpPost, httpDelete, authHeader } = require("../setup");

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E API Keys (HTTP)", () => {
  let keyId;

  beforeAll(async () => {
    await login();
  });

  afterAll(async () => {
    if (keyId) await httpDelete(`/api-keys/${keyId}`, authHeader(token));
  });

  test("GET /api-keys — list, envelope + top-level meta", async () => {
    const { status, body } = await httpGet("/api-keys", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("POST /api-keys — create returns the key once", async () => {
    const { status, body } = await httpPost(
      "/api-keys",
      { name: `E2E Key ${Date.now()}`, scopes: ["CalibrationDevices:read"] },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    keyId = body.data.id;
  });

  test("GET /api-keys/:id — fetch without secret", async () => {
    const { status, body } = await httpGet(`/api-keys/${keyId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body.data.id).toBe(keyId);
  });

  test("DELETE /api-keys/:id — revoke", async () => {
    const { status } = await httpDelete(`/api-keys/${keyId}`, authHeader(token));
    expect(status).toBe(200);
    keyId = null;
  });

  test("GET /api-keys — 401 without token", async () => {
    const { status } = await httpGet("/api-keys");
    expect(status).toBe(401);
  });
});
