/**
 * E2E Tests: GDPR/CCPA module (/api/v1/gdpr)
 *
 * Live smoke coverage:
 *  - POST /gdpr/export           — data export request
 *  - GET  /gdpr/consent/history  — consent audit trail
 *  - GET  /gdpr/processing       — Art.30 processing activities
 *  - PUT  /gdpr/consent          — update consent (validator: {categories,consent})
 *  - PUT  /gdpr/rectify          — rectify data (validator: {field,value})
 *  - POST /gdpr/restrict         — restrict processing (validator: {reason})
 *  - GET  /gdpr/erasure/:id      — erasure status (UUID validated)
 *
 * NOTE: the swagger request bodies documented on the routes DIVERGE from the
 * Joi validators actually enforced — e.g. consent validator wants
 * {categories,consent} not {consents,withdrawAll}; erasure wants {reason,confirm}
 * not {reason,confirmDeletion}. These tests assert the VALIDATOR contract.
 * POST /gdpr/erasure is intentionally NOT exercised (it erases the account).
 */
const { httpGet, httpPost, httpPut, extractToken, authHeader } = require("../setup");

describe("E2E GDPR/CCPA (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /gdpr/processing — 401 without auth", async () => {
    const { status } = await httpGet("/gdpr/processing");
    expect(status).toBe(401);
  });

  test("GET /gdpr/consent/history — 200", async () => {
    const { status } = await httpGet("/gdpr/consent/history", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /gdpr/processing — 200", async () => {
    const { status } = await httpGet("/gdpr/processing", authHeader(token));
    expect(status).toBe(200);
  });

  test("PUT /gdpr/consent — 200 with {categories, consent}", async () => {
    const { status } = await httpPut(
      "/gdpr/consent",
      { categories: ["analytics", "marketing"], consent: true },
      authHeader(token),
    );
    expect(status).toBe(200);
  });

  test("PUT /gdpr/consent — 400 when using the swagger-documented shape {consents}", async () => {
    const { status } = await httpPut(
      "/gdpr/consent",
      { consents: { analytics: true } },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("PUT /gdpr/rectify — 200 with {field, value}", async () => {
    const { status } = await httpPut(
      "/gdpr/rectify",
      { field: "firstName", value: "Sys" },
      authHeader(token),
    );
    expect(status).toBe(200);
  });

  test("POST /gdpr/restrict — 200 with {reason}", async () => {
    const { status } = await httpPost(
      "/gdpr/restrict",
      { reason: "testing restriction" },
      authHeader(token),
    );
    expect(status).toBe(200);
  });

  test("GET /gdpr/erasure/:id — 400 on non-UUID id", async () => {
    const { status } = await httpGet("/gdpr/erasure/not-a-uuid", authHeader(token));
    expect(status).toBe(400);
  });

  test("GET /gdpr/erasure/:id — 404 for an unknown (well-formed) UUID", async () => {
    const { status } = await httpGet(
      "/gdpr/erasure/1f62cf35-e89f-48b3-b29f-c47fe13d1653",
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("POST /gdpr/export — reachable (200 export, or 500 if export backend unavailable)", async () => {
    const { status } = await httpPost("/gdpr/export", { format: "json" }, authHeader(token));
    expect([200, 500]).toContain(status);
  });
});
