/**
 * E2E Tests: Search — /api/v1/search
 *
 * Unified tenant-scoped full-text search across devices, stock, certificates.
 * Results are returned as an object in `data` (grouped by type).
 */
const { httpGet, httpPost, authHeader } = require("../setup") as any;
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup") as any;

let token: any = undefined;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: OPERATOR_PASSWORD });
  token = (body as any).token || ((body as any).data && (body as any).data.token);
  return token;
}

describe("E2E Search (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /search?q=test — returns results object", async () => {
    const { status, body } = await httpGet("/search?q=test", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
    expect(typeof (body as any).data).toBe("object");
  });

  test("GET /search?types=device&q=abc — type filter accepted", async () => {
    const { status, body } = await httpGet("/search?types=device&q=abc", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("GET /search — 401 without token", async () => {
    const { status } = await httpGet("/search?q=test");
    expect(status).toBe(401);
  });
});
