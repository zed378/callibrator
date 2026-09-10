/**
 * E2E Tests: Roles module (/api/v1/roles)
 *
 * Covers RBAC role CRUD + nested menu-group endpoints.
 * A describe-level login() authenticates once as the seeded super-admin and
 * every test reuses the returned access token.
 *
 * NOTE: access tokens are only usable for ~15 min (verifyAccessToken enforces
 * maxAge:"15m"), so the whole suite must run inside that window of the login.
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

// Harness has no PATCH helper; add a local one mirroring its shape.
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

describe("E2E Roles (/api/v1/roles)", () => {
  const created = { roleId: null };

  beforeAll(async () => {
    await waitForServer();
    await login();
  });

  afterAll(async () => {
    if (created.roleId) {
      await httpDelete(`/roles/${created.roleId}`, authHeader(token));
    }
  });

  test("GET /roles — list (envelope: rows in data, meta top-level)", async () => {
    const { status, body } = await httpGet("/roles?page=1&limit=20", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /roles/menus — list menu groups", async () => {
    const { status, body } = await httpGet("/roles/menus", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST /roles — create role", async () => {
    const { status, body } = await httpPost(
      "/roles",
      { name: `E2E Role ${Date.now()}`, description: "created by e2e" },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
    expect(body.success).toBe(true);
    created.roleId = body.data && body.data.id;
    expect(created.roleId).toBeTruthy();
  });

  test("GET /roles/:id — fetch created role", async () => {
    if (!created.roleId) return;
    const { status, body } = await httpGet(`/roles/${created.roleId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body.data.id).toBe(created.roleId);
  });

  test("PATCH /roles/:id — update role", async () => {
    if (!created.roleId) return;
    const { status, body } = await httpPatch(
      `/roles/${created.roleId}`,
      { description: "updated by e2e", status: "active" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /roles/:id — 400 on non-uuid id (validateUuid runs first)", async () => {
    const { status } = await httpGet("/roles/not-a-uuid", authHeader(token));
    expect(status).toBe(400);
  });
});
