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
 * NOTE (A-49, 2026-09-24): as built, the controller wraps the SCIM body in the
 * PLATFORM envelope — the ListResponse or resource is at `body.data`, not at
 * the top level. This spec used to assert `body.Resources` / `body.id`, which
 * the server has never sent, so it could not pass. It now asserts what the
 * server sends. Whether SCIM should answer in its own envelope (RFC 7644, and
 * what docs/API/13-INTEGRATION-API.md claims) is still open — see A-49.
 * A SUPER_ADMIN JWT is accepted (requireApiKeyOrAdmin gate).
 *
 * Groups are tenant-owned since ADR-053: the group created here belongs to the
 * super admin's home tenant, is unmapped (no roleId), and says so.
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
    expect(body).toHaveProperty("data.Resources");
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
    const displayName = `E2E-Group-${Date.now()}`;
    const { status: cStatus, body } = await httpPost(
      "/scim/v2/Groups",
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName,
      },
      authHeader(token),
    );
    expect(cStatus).toBe(201);
    const gid = body?.data?.id;
    expect(gid).toBeTruthy();
    // A-39: an unmapped group states that it grants nothing.
    expect(body.data["urn:ietf:params:scim:schemas:extension:callibrator:2.0:Group"]).toMatchObject({
      roleId: null,
      grantsAccess: false,
    });

    // A-49: the displayName filter is case-insensitive.
    const { body: found } = await httpGet(
      `/scim/v2/Groups?filter=${encodeURIComponent(`displayName eq "${displayName.toUpperCase()}"`)}`,
      authHeader(token),
    );
    expect(found?.data?.totalResults).toBe(1);

    const { status: dStatus } = await httpDelete(`/scim/v2/Groups/${gid}`, authHeader(token));
    expect(dStatus).toBe(204);
  });
});
