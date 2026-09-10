/**
 * E2E Tests: Attachments — /api/v1/attachments
 *
 * Tenant-scoped file storage. Upload is multipart (field "file"); this suite
 * covers the JSON-observable surface: list envelope, UUID validation, 404 on a
 * non-existent id, and auth enforcement. success() puts rows in `data` with a
 * top-level `meta` sibling on the list.
 */
const { httpGet, httpPost, httpDelete, authHeader } = require("../setup");

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E Attachments (HTTP)", () => {
  beforeAll(async () => {
    await login();
  });

  test("GET /attachments — list, envelope + top-level meta", async () => {
    const { status, body } = await httpGet("/attachments", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("GET /attachments — 401 without token", async () => {
    const { status } = await httpGet("/attachments");
    expect(status).toBe(401);
  });

  test("GET /attachments/:id — 400 on malformed UUID", async () => {
    const { status } = await httpGet("/attachments/not-a-uuid", authHeader(token));
    expect(status).toBe(400);
  });

  test("GET /attachments/:id — 404 on non-existent (valid v4 UUID)", async () => {
    const { status } = await httpGet(
      "/attachments/11111111-1111-4111-8111-111111111111",
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("POST /attachments/:id/signed-url — 404 for unknown attachment", async () => {
    const { status } = await httpPost(
      "/attachments/11111111-1111-4111-8111-111111111111/signed-url",
      { expiresInSec: 300 },
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("DELETE /attachments/:id — 404 for unknown attachment", async () => {
    const { status } = await httpDelete(
      "/attachments/11111111-1111-4111-8111-111111111111",
      authHeader(token),
    );
    expect(status).toBe(404);
  });
});
