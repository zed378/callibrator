/**
 * E2E Tests: Users module (/api/v1/users)
 *
 * Endpoints:
 *   GET    /all                 — paginated user list
 *   POST   /detail              — { userId } fetch one
 *   POST   /username-check      — { username } availability
 *   POST   /role-update         — { userId, roleId }
 *   POST   /create              — create user (username, firstName, lastName,
 *                                 email, password, roleId)
 *   PATCH  /edit                — { userId, ...fields }
 *   DELETE /delete              — { userId }
 *   POST   /:userId/avatar | DELETE /:userId/avatar
 *
 * Needs a roleId (from /roles). Runs inside the ~15-min access-token window.
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
  waitForServer,
  API_BASE,
  defaultHeaders,
} = require("../setup");

async function httpPatch(path, data = {}, headers = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body };
}

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

describe("E2E Users (/api/v1/users)", () => {
  let roleId = null;
  let altRoleId = null;
  const created = { userId: null };

  beforeAll(async () => {
    await waitForServer();
    await login();
    const { body } = await httpGet("/roles?limit=5", authHeader(token));
    const rows = Array.isArray(body.data) ? body.data : [];
    roleId = rows[0] && rows[0].id;
    // A DIFFERENT role for the reassignment test — reassigning the same role
    // correctly returns 400 "User already has this role".
    altRoleId = (rows[1] && rows[1].id) || roleId;
  });

  afterAll(async () => {
    if (created.userId) {
      // deleteUser reads userId from req.query (userParamSchema on req.query).
      await httpDelete(`/users/delete?userId=${created.userId}`, authHeader(token));
    }
  });

  test("GET /users/all — list", async () => {
    const { status, body } = await httpGet("/users/all?page=1&limit=20", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("POST /users/username-check — availability", async () => {
    const { status, body } = await httpPost(
      "/users/username-check",
      { username: `e2euser${Date.now()}`.slice(0, 20) },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST /users/create — create user", async () => {
    if (!roleId) return;
    const stamp = Date.now();
    const { status, body } = await httpPost(
      "/users/create",
      {
        username: `e2eu${stamp}`.slice(0, 20),
        firstName: "E2E",
        lastName: "User",
        email: `e2e${stamp}@example.com`,
        password: "Password123!",
        roleId,
      },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
    expect(body.success).toBe(true);
    created.userId = body.data && body.data.id;
  });

  test("POST /users/detail — fetch created user", async () => {
    if (!created.userId) return;
    const { status, body } = await httpPost(
      "/users/detail",
      { userId: created.userId },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("PATCH /users/edit — update user", async () => {
    if (!created.userId) return;
    const { status, body } = await httpPatch(
      "/users/edit",
      { userId: created.userId, firstName: "Edited" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST /users/role-update — reassign role", async () => {
    if (!created.userId || !altRoleId || altRoleId === roleId) return;
    const { status, body } = await httpPost(
      "/users/role-update",
      { userId: created.userId, roleId: altRoleId },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
    expect(body.success).toBe(true);
  });

  test("POST /users/create — 400 on missing required fields", async () => {
    const { status } = await httpPost("/users/create", { username: "x" }, authHeader(token));
    expect([400, 422]).toContain(status);
  });

  test("DELETE /users/delete?userId= — remove created user", async () => {
    if (!created.userId) return;
    // deleteUser validates req.query.userId (userParamSchema), not the body.
    const { status, body } = await httpDelete(
      `/users/delete?userId=${created.userId}`,
      authHeader(token),
    );
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
      created.userId = null;
    }
  });

  test("DELETE /users/delete — 400 when userId query param missing", async () => {
    const { status } = await httpDelete("/users/delete", authHeader(token));
    expect(status).toBe(400);
  });
});
