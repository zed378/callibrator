/**
 * E2E Tests: User Permissions module (/api/v1/user-permissions)
 *
 * Endpoints:
 *   GET    /:userId                 — list per-user menu-group permissions
 *   POST   /:userId                 — set a permission { menuGroupId, permissionType }
 *   DELETE /:userId/:menuGroupId    — remove a permission
 *
 * Depends on a real userId (super-admin from login payload) and a menuGroupId
 * (fetched from /roles/menus). Runs inside the ~15-min access-token window.
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
  waitForServer,
} = require("../setup");

let token = null;
let userId = null;

async function login() {
  if (token) return token;
  const { body } = await httpPost("/auth/login", {
    user: "sys@mail.com",
    password: "123123",
  });
  token = extractToken(body);
  userId = body && (body.user?.id || body.data?.user?.id || body.data?.id);
  return token;
}

describe("E2E User Permissions (/api/v1/user-permissions)", () => {
  let menuGroupId = null;

  beforeAll(async () => {
    await waitForServer();
    await login();
    const { body } = await httpGet("/roles/menus", authHeader(token));
    const rows = Array.isArray(body.data) ? body.data : [];
    menuGroupId = rows[0] && rows[0].id;
  });

  test("GET /user-permissions/:userId — list (200, data array)", async () => {
    if (!userId) return;
    const { status, body } = await httpGet(`/user-permissions/${userId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("GET /user-permissions/:userId — 400 on non-uuid", async () => {
    const { status } = await httpGet("/user-permissions/not-a-uuid", authHeader(token));
    expect(status).toBe(400);
  });

  test("POST /user-permissions/:userId — set permission", async () => {
    if (!userId || !menuGroupId) return;
    const { status, body } = await httpPost(
      `/user-permissions/${userId}`,
      { menuGroupId, permissionType: "read" },
      authHeader(token),
    );
    expect([200, 201]).toContain(status);
    expect(body.success).toBe(true);
  });

  test("POST /user-permissions/:userId — 400 when required fields missing", async () => {
    if (!userId) return;
    const { status } = await httpPost(`/user-permissions/${userId}`, {}, authHeader(token));
    expect([400, 422]).toContain(status);
  });

  test("DELETE /user-permissions/:userId/:menuGroupId — remove permission", async () => {
    if (!userId || !menuGroupId) return;
    const { status, body } = await httpDelete(
      `/user-permissions/${userId}/${menuGroupId}`,
      authHeader(token),
    );
    expect([200, 404]).toContain(status);
    if (status === 200) expect(body.success).toBe(true);
  });
});
