/**
 * E2E Tests: Tenant Hierarchy module (/api/v1/tenant-hierarchy)
 *
 * Mounts: tenantHierarchy.route.js — parent/child business-unit tree.
 * All routes are auth-only (no dynamicAccess), so a super-admin token reaches
 * every handler. Verified live: /tree, /cross-tenant-roles and the per-tenant
 * read routes (children/parent/descendants/ancestors) all return 200.
 *
 * NOTE: addChildTenant validates the body itself (the Joi schema is NOT wired
 * as middleware — see the comment in the route file about the .validate bug),
 * so a bad/short name or a non-existent parentId yields 400/404, not 500.
 */
const { httpGet, httpPost, authHeader } = require("../setup");

describe("E2E Tenant Hierarchy (HTTP)", () => {
  let token;
  let tenantId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
    token = body.token || (body.data && body.data.token);
    const list = await httpGet("/tenants/all", authHeader(token));
    if (Array.isArray(list.body?.data) && list.body.data.length) {
      tenantId = list.body.data[0].id;
    }
  });

  test("GET /tenant-hierarchy/tree -> 200", async () => {
    const { status } = await httpGet("/tenant-hierarchy/tree", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenant-hierarchy/tree -> 401 without token", async () => {
    const { status } = await httpGet("/tenant-hierarchy/tree");
    expect(status).toBe(401);
  });

  test("GET /tenant-hierarchy/cross-tenant-roles -> 200", async () => {
    const { status } = await httpGet("/tenant-hierarchy/cross-tenant-roles", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenant-hierarchy/:id/children -> 200", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenant-hierarchy/${tenantId}/children`, authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenant-hierarchy/:id/parent -> 200", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenant-hierarchy/${tenantId}/parent`, authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenant-hierarchy/:id/descendants -> 200", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenant-hierarchy/${tenantId}/descendants`, authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenant-hierarchy/:id/ancestors -> 200", async () => {
    if (!tenantId) return;
    const { status } = await httpGet(`/tenant-hierarchy/${tenantId}/ancestors`, authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /tenant-hierarchy/:id/children -> 400 on non-uuid id (validateUuid)", async () => {
    const { status } = await httpGet("/tenant-hierarchy/not-a-uuid/children", authHeader(token));
    expect(status).toBe(400);
  });

  test("POST /tenant-hierarchy/:parentId/children -> 400 on missing name (self-validated)", async () => {
    if (!tenantId) return;
    const { status } = await httpPost(
      `/tenant-hierarchy/${tenantId}/children`,
      { code: "nocode" },
      authHeader(token),
    );
    expect([400, 404]).toContain(status);
  });
});
