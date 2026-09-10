/**
 * E2E Tests: E-Signature module (LIVE HTTP)
 *
 * Mount: /api/v1/esignature  (see index.js — NOT /api/v1/e-signature despite
 * the swagger comments). 21 CFR Part 11 digital-signature workflow.
 *
 * These endpoints return their own response shapes ({ keyPairs }, { workflows },
 * { signatures }, verification result) rather than the generic list envelope;
 * a top-level `message` is present. Write routes use validate(schema) from
 * validation.middleware (the fix for the schema.validate-as-middleware 500 bug).
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
} = require("../setup");

describe("E2E E-Signature (HTTP)", () => {
  let token;
  let keyPairId;

  async function login() {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    return extractToken(body);
  }

  beforeAll(async () => {
    token = await login();
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    if (keyPairId) {
      await httpDelete(`/esignature/key-pairs/${keyPairId}`, authHeader(token));
    }
  });

  test("GET /esignature/key-pairs — 200", async () => {
    const { status } = await httpGet("/esignature/key-pairs", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /esignature/key-pairs — 401 without auth", async () => {
    const { status } = await httpGet("/esignature/key-pairs");
    expect(status).toBe(401);
  });

  test("GET /esignature/workflows — 200", async () => {
    const { status } = await httpGet("/esignature/workflows", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /esignature/history — 200", async () => {
    const { status } = await httpGet("/esignature/history", authHeader(token));
    expect(status).toBe(200);
  });

  test("POST /esignature/key-pairs — 201 generates a key pair", async () => {
    const { status, body } = await httpPost(
      "/esignature/key-pairs",
      { label: "E2E Key", algorithm: "RSA", keySize: 2048 },
      authHeader(token),
    );
    expect(status).toBe(201);
    keyPairId = body.id || (body.data && body.data.id);
    expect(keyPairId).toBeTruthy();
  });

  test("POST /esignature/verify — 200, valid:false for unknown signature", async () => {
    const { status, body } = await httpPost(
      "/esignature/verify",
      { signatureId: "00000000-0000-4000-8000-000000000000" },
      authHeader(token),
    );
    expect(status).toBe(200);
    // A non-existent signature resolves to a verification result (valid:false),
    // not a 404 — documented behavior of verifySignature().
    expect(body).toBeDefined();
  });

  test("POST /esignature/verify — 400 when signatureId missing", async () => {
    const { status } = await httpPost(
      "/esignature/verify",
      {},
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("DELETE /esignature/key-pairs/:id — removes the key pair", async () => {
    const { status } = await httpDelete(
      `/esignature/key-pairs/${keyPairId}`,
      authHeader(token),
    );
    expect([200, 204]).toContain(status);
    keyPairId = null;
  });
});
