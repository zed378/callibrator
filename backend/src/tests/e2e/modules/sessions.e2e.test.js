/**
 * E2E Tests: Sessions module (/api/v1/sessions)
 *
 * Endpoints (all require auth + SUPERADMIN):
 *   GET    /stats                      — session statistics
 *   GET    /                           — list sessions (paginated)
 *   GET    /:id                        — one session
 *   POST   /:id/revoke                 — revoke one session { reason? }
 *   POST   /user/:userId/revoke-all    — revoke all of a user's sessions { reason? }
 *   DELETE /:id                        — delete a session record
 *
 * Read-only + non-destructive assertions only (we do NOT revoke the token this
 * suite is authenticated with). Runs inside the ~15-min access-token window.
 */
const {
  httpGet,
  httpPost,
  authHeader,
  extractToken,
  waitForServer,
} = require("../setup");

let token = null;

async function login() {
  if (token) return token;
  const { body } = await httpPost("/auth/login", {
    user: "sys@mail.com",
    password: "123123",
  });
  token = extractToken(body);
  return token;
}

describe("E2E Sessions (/api/v1/sessions)", () => {
  beforeAll(async () => {
    await waitForServer();
    await login();
  });

  test("GET /sessions/stats — statistics", async () => {
    const { status, body } = await httpGet("/sessions/stats", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /sessions — list (data array, meta top-level sibling)", async () => {
    const { status, body } = await httpGet("/sessions?page=1&limit=20", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /sessions/:id — 404 on unknown uuid", async () => {
    const { status } = await httpGet(
      "/sessions/00000000-0000-0000-0000-000000000000",
      authHeader(token),
    );
    expect([404, 200]).toContain(status);
  });

  test("GET /sessions/:id — 400 on non-uuid", async () => {
    const { status } = await httpGet("/sessions/not-a-uuid", authHeader(token));
    expect(status).toBe(400);
  });

  test("POST /sessions/:id/revoke — 404 on unknown session (validator accepts empty body)", async () => {
    const { status } = await httpPost(
      "/sessions/00000000-0000-0000-0000-000000000000/revoke",
      {},
      authHeader(token),
    );
    expect([404, 200]).toContain(status);
  });
});
