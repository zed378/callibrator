/**
 * E2E Tests: Supplier Scorecard module (LIVE HTTP)
 *
 * Mount: /api/v1/supplier-scorecard  (see index.js)
 * Route file: src/routes/api/supplierScorecard.route.ts
 *
 * Covered routes:
 *   POST   /supplier-scorecard          (denyApiKey)
 *   GET    /supplier-scorecard
 *   GET    /supplier-scorecard/:id
 *   PUT    /supplier-scorecard/:id       (denyApiKey)
 *   DELETE /supplier-scorecard/:id       (denyApiKey)
 *
 * A parent Vendor is created first (scorecard FKs vendorId) and cleaned up at
 * the end. getScorecards returns rows in `data` (array) + `meta` sibling.
 *
 * A-347 (2026-10-02): `status` is the A-336 contract's vocabulary
 * (`APPROVED` / `PROBATION` / `DISQUALIFIED`, as the frontend sends); the
 * title-case `Approved` this spec sent is a 400, asserted below. A-346: a
 * malformed `:id` is a 400 (`validateUuid`), never the 500 it was.
 */
const {
  httpGet,
  httpPost,
  httpPut,
  httpDelete,
  authHeader,
  extractToken,
} = require("../setup");
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup");

describe("E2E Supplier Scorecard (HTTP)", () => {
  let token;
  let auth;
  const ids = { vendor: null, scorecard: null };

  async function login() {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: OPERATOR_PASSWORD,
    });
    return extractToken(body);
  }

  beforeAll(async () => {
    token = await login();
    expect(token).toBeTruthy();
    auth = authHeader(token);

    const v = await httpPost(
      "/vendors",
      { name: "E2E Scorecard Vendor", type: "PartsSupplier", status: "Active" },
      auth,
    );
    ids.vendor = v.body?.data?.id;
  });

  afterAll(async () => {
    if (ids.scorecard) {await httpDelete(`/supplier-scorecard/${ids.scorecard}`, auth);}
    if (ids.vendor) {await httpDelete(`/vendors/${ids.vendor}`, auth);}
  });

  test("GET /supplier-scorecard — 200, data array, meta top-level", async () => {
    const { status, body } = await httpGet(
      "/supplier-scorecard?page=1&limit=5",
      auth,
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test("POST /supplier-scorecard — 201 creates scorecard", async () => {
    const { status, body } = await httpPost(
      "/supplier-scorecard",
      {
        vendorId: ids.vendor,
        evaluationDate: "2026-07-01",
        qualityScore: 90,
        deliveryScore: 85,
        serviceScore: 80,
        status: "APPROVED",
        comments: "e2e evaluation",
      },
      auth,
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    ids.scorecard = body.data.id;
  });

  test("POST /supplier-scorecard — 400 on a status outside the contract (A-347)", async () => {
    const { status } = await httpPost(
      "/supplier-scorecard",
      { vendorId: ids.vendor, evaluationDate: "2026-07-01", status: "Approved" },
      auth,
    );
    expect(status).toBe(400);
  });

  test("POST /supplier-scorecard — 404 on unknown vendorId", async () => {
    const { status } = await httpPost(
      "/supplier-scorecard",
      {
        vendorId: "00000000-0000-4000-8000-000000000000",
        evaluationDate: "2026-07-01",
      },
      auth,
    );
    expect(status).toBe(404);
  });

  test("GET /supplier-scorecard/:id — 200 returns scorecard", async () => {
    const { status, body } = await httpGet(
      `/supplier-scorecard/${ids.scorecard}`,
      auth,
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(ids.scorecard);
  });

  test("PUT /supplier-scorecard/:id — 200 updates scorecard", async () => {
    const { status } = await httpPut(
      `/supplier-scorecard/${ids.scorecard}`,
      { qualityScore: 95, comments: "reviewed" },
      auth,
    );
    expect(status).toBe(200);
  });

  test("GET /supplier-scorecard/:id — 404 on unknown id", async () => {
    const { status } = await httpGet(
      "/supplier-scorecard/00000000-0000-4000-8000-000000000000",
      auth,
    );
    expect(status).toBe(404);
  });

  test.each(["get", "put", "delete"])(
    "%s /supplier-scorecard/null — 400 malformed id, never 500 (A-346)",
    async (method) => {
      const send = { get: httpGet, put: httpPut, delete: httpDelete }[method];
      const { status } =
        method === "put"
          ? await send("/supplier-scorecard/null", { comments: "x" }, auth)
          : await send("/supplier-scorecard/null", auth);
      expect(status).toBe(400);
    },
  );

  test("GET /supplier-scorecard — 401 without token", async () => {
    const { status } = await httpGet("/supplier-scorecard");
    expect(status).toBe(401);
  });

  test("DELETE /supplier-scorecard/:id — 200 deletes scorecard", async () => {
    const { status } = await httpDelete(
      `/supplier-scorecard/${ids.scorecard}`,
      auth,
    );
    expect(status).toBe(200);
    ids.scorecard = null;
  });
});
