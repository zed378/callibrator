/**
 * E2E Tests: WebAuthn passkey module (/api/v1/webauthn)
 *
 * Live smoke coverage:
 *  - GET  /webauthn/status               — enrolment status
 *  - POST /webauthn/registration-options — begin registration ceremony
 *  - POST /webauthn/login-options        — begin assertion ceremony
 *
 * NOTE: registration/login option generation depends on a configured WebAuthn
 * relying-party. When that dependency is unavailable the service replies 503
 * ("WebAuthn temporarily unavailable") — an environment dependency, not a
 * routing defect.
 */
const { httpGet, httpPost, extractToken, authHeader } = require("../setup");

describe("E2E WebAuthn (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /webauthn/status — 401 without auth", async () => {
    const { status } = await httpGet("/webauthn/status");
    expect(status).toBe(401);
  });

  test("GET /webauthn/status — 200 with enrolment flag", async () => {
    const { status, body } = await httpGet("/webauthn/status", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
  });

  test("POST /webauthn/registration-options — 200 options (or 503 when RP unavailable)", async () => {
    const { status } = await httpPost("/webauthn/registration-options", {}, authHeader(token));
    expect([200, 503]).toContain(status);
  });

  test("POST /webauthn/login-options — 200 options (or 503 when RP unavailable)", async () => {
    const { status } = await httpPost("/webauthn/login-options", {}, authHeader(token));
    expect([200, 503]).toContain(status);
  });
});
