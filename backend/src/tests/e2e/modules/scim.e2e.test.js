/**
 * E2E Tests: SCIM v2 provisioning module (/api/v1/scim/v2)
 *
 * Live smoke coverage:
 *  - GET    /scim/v2/Users        — list provisioned users
 *  - GET    /scim/v2/Users/:id     — get user (404 for unknown)
 *  - GET    /scim/v2/Groups        — list groups
 *  - POST   /scim/v2/Groups        — provision a group (201)
 *  - DELETE /scim/v2/Groups/:id     — de-provision (204)
 *
 * NOTE: SCIM endpoints return the SCIM JSON envelope (schemas/Resources/Error),
 * NOT the platform {success,status,message,data} envelope — this is by spec.
 * A SUPER_ADMIN JWT is accepted (requireApiKeyOrAdmin gate).
 */
const { httpGet, httpPost, httpDelete, extractToken, authHeader } = require("../setup");

describe("E2E SCIM v2 (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("GET /scim/v2/Users — 200 list", async () => {
    const { status, body } = await httpGet("/scim/v2/Users", authHeader(token));
    expect(status).toBe(200);
    expect(body).toHaveProperty("Resources");
  });

  test("GET /scim/v2/Groups — 200 list", async () => {
    const { status } = await httpGet("/scim/v2/Groups", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /scim/v2/Users/:id — 404 for unknown id", async () => {
    const { status } = await httpGet(
      "/scim/v2/Users/22222222-2222-2222-2222-222222222222",
      authHeader(token),
    );
    expect(status).toBe(404);
  });

  test("POST /scim/v2/Groups — 201 then DELETE /scim/v2/Groups/:id — 204", async () => {
    const { status: cStatus, body } = await httpPost(
      "/scim/v2/Groups",
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: `E2E-Group-${Date.now()}`,
      },
      authHeader(token),
    );
    expect(cStatus).toBe(201);
    const gid = body?.id;
    expect(gid).toBeTruthy();

    const { status: dStatus } = await httpDelete(`/scim/v2/Groups/${gid}`, authHeader(token));
    expect(dStatus).toBe(204);
  });
});
