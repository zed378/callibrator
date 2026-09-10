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
  authHeader,
  extractToken,
  waitForServer,
  BASE_URL,
} = require("../setup");

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

  beforeAll(async () => {
    await waitForServer();
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
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
      authHeader(token)
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    expect(body.data.documentNumber).toMatch(/^SOP-/);
    expect(body.data.status).toBe("DRAFT");
    docId = body.data.id;
  });

  test("PATCH /sop/:id/publish — 200 moves to PUBLISHED", async () => {
    expect(docId).toBeTruthy();
    const { status, body } = await rawPatch(`/sop/${docId}/publish`, token);
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
      authHeader(token)
    );
    expect(status).toBe(404);
  });

  test("GET /sop — 401 without auth", async () => {
    const { status } = await httpGet("/sop");
    expect(status).toBe(401);
  });
});
