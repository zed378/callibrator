/**
 * E2E Tests: Menu Groups module.
 *
 * The same router is mounted at BOTH /api/v1/menu-groups and
 * /api/v1/menu-group-roles (index.js). This suite exercises the router under
 * both prefixes.
 *
 * Endpoints (relative to either mount):
 *   POST /filter              — filter menu groups
 *   POST /get-assignments     — { roleId } role -> menu-group assignments
 *   GET  /menu-groups         — menu groups for the authed user
 *   GET  /menu-groups/admin   — admin listing
 *   GET  /roles               — available roles
 *   POST /create              — create { name }
 *   POST /update              — update { id, name }
 *   POST /delete              — delete { id }
 *   POST /assign | /revoke | /assign-item | /revoke-item | /bulk-assign | /bulk-revoke
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

describe("E2E Menu Groups (/api/v1/menu-groups + /menu-group-roles)", () => {
  const created = { id: null };

  beforeAll(async () => {
    await waitForServer();
    await login();
  });

  test("POST /menu-groups/filter — 200", async () => {
    const { status, body } = await httpPost("/menu-groups/filter", {}, authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /menu-groups/menu-groups — user menu groups", async () => {
    const { status, body } = await httpGet("/menu-groups/menu-groups", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /menu-groups/roles — available roles", async () => {
    const { status, body } = await httpGet("/menu-groups/roles", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /menu-group-roles/roles — SAME router via 2nd mount", async () => {
    const { status, body } = await httpGet("/menu-group-roles/roles", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST /menu-groups/create — create menu group", async () => {
    const { status, body } = await httpPost(
      "/menu-groups/create",
      { name: `E2E MG ${Date.now()}`, slug: `e2e-mg-${Date.now()}`, isActive: true },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
    expect(body.success).toBe(true);
    created.id = body.data && body.data.id;
  });

  test("POST /menu-groups/update — update menu group", async () => {
    if (!created.id) return;
    const { status, body } = await httpPost(
      "/menu-groups/update",
      { id: created.id, name: `E2E MG upd ${Date.now()}` },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST /menu-groups/create — 400 on missing name", async () => {
    const { status } = await httpPost("/menu-groups/create", {}, authHeader(token));
    expect([400, 422]).toContain(status);
  });

  test("POST /menu-groups/delete — delete menu group (cleanup)", async () => {
    if (!created.id) return;
    const { status } = await httpPost(
      "/menu-groups/delete",
      { id: created.id },
      authHeader(token),
    );
    expect([200, 404]).toContain(status);
  });
});
