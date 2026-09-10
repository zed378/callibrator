/**
 * E2E Tests: QMS (/api/v1/qms) — Non-Conformance + CAPA
 *
 * Live smoke against the running server. Logs in once as the seeded
 * super-admin and reuses the access token for every request.
 *
 * NOTES / DEFECTS (documented):
 *  - Envelope deviation: GET /qms/nc and /qms/capa return `data` as an OBJECT
 *    ({ total, page, limit, totalPages, nonConformances|capas: [] }) — rows are
 *    nested under a key and pagination lives INSIDE data, unlike the house
 *    envelope (data = array, meta = top-level sibling).
 *  - PATCH /qms/nc/:id has no validator: a status outside the DB enum
 *    (OPEN, UNDER_INVESTIGATION, CAPA_REQUIRED, CLOSED) yields an unhandled 500
 *    (raw SQL enum error) instead of a 400.
 */
const {
  httpGet,
  httpPost,
  authHeader,
  extractToken,
  waitForServer,
} = require("../setup");

describe("E2E QMS (HTTP)", () => {
  let token;
  let ncId;

  beforeAll(async () => {
    await waitForServer();
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /qms/nc — 200 (house envelope: data=array, pagination in meta)", async () => {
    const { status, body } = await httpGet("/qms/nc", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toEqual(
      expect.objectContaining({ total: expect.any(Number), page: expect.any(Number) }),
    );
  });

  test("POST /qms/nc — 201 creates a non-conformance", async () => {
    const { status, body } = await httpPost(
      "/qms/nc",
      { title: "E2E NC", description: "e2e", severity: "HIGH" },
      authHeader(token)
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    expect(body.data.ncNumber).toMatch(/^NC-/);
    ncId = body.data.id;
  });

  test("PATCH /qms/nc/:id — 200 with a valid enum status", async () => {
    expect(ncId).toBeTruthy();
    // setup has no PATCH helper — use raw fetch through httpPost's sibling.
    const { status } = await rawPatch(
      `/qms/nc/${ncId}`,
      { status: "UNDER_INVESTIGATION", rootCause: "root" },
      token
    );
    expect(status).toBe(200);
  });

  test("PATCH /qms/nc/:id — out-of-enum status rejected with 400 (validator)", async () => {
    expect(ncId).toBeTruthy();
    const { status } = await rawPatch(
      `/qms/nc/${ncId}`,
      { status: "IN_PROGRESS" }, // not a valid NC status
      token
    );
    expect(status).toBe(400);
  });

  test("GET /qms/capa — 200 (house envelope: data=array, pagination in meta)", async () => {
    const { status, body } = await httpGet("/qms/capa", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toEqual(
      expect.objectContaining({ total: expect.any(Number), page: expect.any(Number) }),
    );
  });

  test("POST /qms/capa — 201 linked to the NC", async () => {
    expect(ncId).toBeTruthy();
    const { status, body } = await httpPost(
      "/qms/capa",
      { ncId, title: "E2E CAPA", actionPlan: "fix" },
      authHeader(token)
    );
    expect(status).toBe(201);
    expect(body.data.capaNumber).toMatch(/^CAPA-/);
  });

  test("POST /qms/capa — 404 when ncId does not exist", async () => {
    const { status } = await httpPost(
      "/qms/capa",
      {
        ncId: "00000000-0000-4000-8000-000000000000",
        title: "x",
        actionPlan: "y",
      },
      authHeader(token)
    );
    expect(status).toBe(404);
  });

  test("GET /qms/nc — 401 without auth", async () => {
    const { status } = await httpGet("/qms/nc");
    expect(status).toBe(401);
  });
});

// Minimal PATCH via native fetch — setup.js exposes no PATCH helper.
const { BASE_URL } = require("../setup");
async function rawPatch(path, data, token) {
  const resp = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  return { status: resp.status, body };
}
