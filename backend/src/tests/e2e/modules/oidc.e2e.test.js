/**
 * E2E Tests: OIDC provider module (/api/v1/oidc)
 *
 * Live smoke coverage:
 *  - GET  /oidc/.well-known/openid-configuration — discovery (PUBLIC)
 *  - GET  /oidc/.well-known/jwks.json            — JWKS (PUBLIC)
 *  - GET  /oidc/clients                          — list tenant clients
 *  - POST /oidc/clients                          — register client (super admin)
 *  - DELETE /oidc/clients/:clientId              — delete client (super admin)
 */
const { httpGet, httpPost, httpDelete, extractToken, authHeader } = require("../setup");

describe("E2E OIDC Provider (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /oidc/.well-known/openid-configuration — 200 PUBLIC (no auth)", async () => {
    const { status } = await httpGet("/oidc/.well-known/openid-configuration");
    expect(status).toBe(200);
  });

  test("GET /oidc/.well-known/jwks.json — 200 PUBLIC (no auth)", async () => {
    const { status } = await httpGet("/oidc/.well-known/jwks.json");
    expect(status).toBe(200);
  });

  test("GET /oidc/clients — 401 without auth", async () => {
    const { status } = await httpGet("/oidc/clients");
    expect(status).toBe(401);
  });

  test("GET /oidc/clients — 200 list", async () => {
    const { status } = await httpGet("/oidc/clients", authHeader(token));
    expect(status).toBe(200);
  });

  test("POST /oidc/clients — register then DELETE the client", async () => {
    const { status: cStatus, body } = await httpPost(
      "/oidc/clients",
      {
        name: "E2E Client",
        redirectUris: ["https://app.example.com/cb"],
        scopes: ["openid", "profile"],
        grantTypes: ["authorization_code"],
      },
      authHeader(token),
    );
    // Handler returns 200 (success envelope) on registration.
    expect([200, 201]).toContain(cStatus);
    const data = body?.data || {};
    const clientId = data.clientId || data.client_id || data.id;
    expect(clientId).toBeTruthy();

    const { status: dStatus } = await httpDelete(`/oidc/clients/${clientId}`, authHeader(token));
    expect(dStatus).toBe(200);
  });
});
