/**
 * E2E Tests: SOP / Document Control (/api/v1/sop)
 *
 * Live smoke against the running server. Logs in once as the seeded
 * super-admin and reuses the access token for every request.
 *
 * NOTE (envelope deviation): GET /sop returns `data` as an OBJECT
 * ({ total, page, limit, totalPages, documents: [] }) — rows are nested under
 * `documents` and pagination lives INSIDE data, unlike the house envelope
 * (data = array, meta = top-level sibling).
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
  waitForServer,
  BASE_URL,
} = require("../setup");

// P6-02: a controlled procedure is released by someone OTHER than its author
// (sop.service#publishDocument answers 409 to the author — 21 CFR 11 / ISO
// 13485 two-person release). The spec used to publish as the super admin who
// authored it, which the product now refuses. A second administrator of the
// same tenant releases it: created here, made to replace the temporary
// password an administrator set (A-215, PASSWORD_CHANGE_REQUIRED otherwise),
// signed in again, and deleted afterwards.
const HEALTHCARE_ADMIN_ROLE = "HEALTHCARE ADMIN";

async function createReleaser(adminToken, tenantId) {
  const roles = await httpGet("/roles?limit=50", authHeader(adminToken));
  const role = (roles.body.data || []).find((r) => r.name === HEALTHCARE_ADMIN_ROLE);
  const stamp = Date.now();
  const email = `sop-releaser-${stamp}@example.com`;
  const temporary = `Temp-${stamp}-Aa1!`;
  const created = await httpPost(
    "/users/create",
    {
      tenantId,
      username: `soprel${stamp}`.slice(0, 20),
      firstName: "Sop",
      lastName: "Releaser",
      email,
      password: temporary,
      roleId: role.id,
    },
    authHeader(adminToken),
  );
  const userId = created.body.data.id;
  const first = await httpPost("/auth/login", { user: email, password: temporary });
  const chosen = `Chosen-${stamp}-Bb2!`;
  const changed = await httpPost(
    "/auth/just-update-password",
    { currentPassword: temporary, newPassword: chosen },
    authHeader(extractToken(first.body)),
  );
  if (changed.status !== 200) {
    throw new Error(`E2E: the SOP releaser could not set a password (${changed.status})`);
  }
  const second = await httpPost("/auth/login", { user: email, password: chosen });
  return { userId, token: extractToken(second.body) };
}

async function rawPatch(path, token) {
  const resp = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  return { status: resp.status, body };
}

describe("E2E SOP (HTTP)", () => {
  let token;
  let docId;
  let releaser;

  beforeAll(async () => {
    await waitForServer();
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
    releaser = await createReleaser(token, body.data.tenantId);
    expect(releaser.token).toBeTruthy();
  });

  afterAll(async () => {
    if (releaser && releaser.userId) {
      await httpDelete(`/users/delete?userId=${releaser.userId}`, authHeader(token));
    }
  });

  test("GET /sop — 200 (house envelope: data=array, pagination in meta)", async () => {
    const { status, body } = await httpGet("/sop", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toEqual(
      expect.objectContaining({ total: expect.any(Number), page: expect.any(Number) }),
    );
  });

  test("POST /sop — 201 auto-numbers the document", async () => {
    const { status, body } = await httpPost(
      "/sop",
      { title: "E2E SOP", requiresTraining: false },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    expect(body.data.documentNumber).toMatch(/^SOP-/);
    expect(body.data.status).toBe("DRAFT");
    docId = body.data.id;
  });

  test("PATCH /sop/:id/publish — 409 for the document's own author", async () => {
    expect(docId).toBeTruthy();
    const { status, body } = await rawPatch(`/sop/${docId}/publish`, token);
    expect(status).toBe(409);
    expect(body.message).toMatch(/someone other than its author/);
  });

  test("PATCH /sop/:id/publish — 200 moves to PUBLISHED, released by a second user", async () => {
    expect(docId).toBeTruthy();
    const { status, body } = await rawPatch(`/sop/${docId}/publish`, releaser.token);
    expect(status).toBe(200);
    expect(body.data.status).toBe("PUBLISHED");
  });

  test("POST /sop/:id/acknowledge — 404 when no training ack exists", async () => {
    // Document was created with requiresTraining:false, so publish did not
    // generate acknowledgment rows; acknowledging is a domain-correct 404.
    expect(docId).toBeTruthy();
    const { status } = await httpPost(
      `/sop/${docId}/acknowledge`,
      {},
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("GET /sop — 401 without auth", async () => {
    const { status } = await httpGet("/sop");
    expect(status).toBe(401);
  });
});
