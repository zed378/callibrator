/**
 * E2E Tests: Search — /api/v1/search
 *
 * Unified tenant-scoped full-text search across devices, stock, certificates.
 * Results are returned as an object in `data` (grouped by type).
 */
const { httpGet, httpPost, authHeader } = require("../setup");

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E Search (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /search?q=test — returns results object", async () => {
    const { status, body } = await httpGet("/search?q=test", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data).toBe("object");
  });

  test("GET /search?types=device&q=abc — type filter accepted", async () => {
    const { status, body } = await httpGet("/search?types=device&q=abc", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /search — 401 without token", async () => {
    const { status } = await httpGet("/search?q=test");
    expect(status).toBe(401);
  });
});
