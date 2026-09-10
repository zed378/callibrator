/**
 * E2E Tests: Custom Domains module (/api/v1/custom-domains)
 *
 * Mounts: customDomains.route.js — vanity/custom domain management.
 * Routes: GET /domains, POST /domains, POST /domains/:id/verify,
 * DELETE /domains/:id, GET /domains/:id/status, POST /domains/:id/default,
 * GET /domains/:id/dns.
 *
 * NOTE (by config, not a defect): custom domains are gated by a feature flag.
 * On the seeded environment POST /domains returns 400 "Custom domains are
 * disabled" (customDomains.service.addDomain), so no domain can be created and
 * the per-:id routes (verify/status/dns/default/delete) cannot be exercised
 * from this smoke test. The addDomain Joi schema IS correctly wired via
 * validate(addDomain) — the earlier "schema.validate as middleware" 500 bug
 * is fixed here.
 */
const { httpGet, httpPost, authHeader } = require("../setup");

describe("E2E Custom Domains (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
    token = body.token || (body.data && body.data.token);
  });

  test("GET /custom-domains/domains -> 200", async () => {
    const { status } = await httpGet("/custom-domains/domains", authHeader(token));
    expect(status).toBe(200);
  });

  test("GET /custom-domains/domains -> 401 without token", async () => {
    const { status } = await httpGet("/custom-domains/domains");
    expect(status).toBe(401);
  });

  test("POST /custom-domains/domains -> 400 on invalid hostname (validator)", async () => {
    const { status, body } = await httpPost(
      "/custom-domains/domains",
      { domain: "not a host name!!" },
      authHeader(token),
    );
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  test("POST /custom-domains/domains -> 201 or 400 'disabled' with a valid body", async () => {
    const { status, body } = await httpPost(
      "/custom-domains/domains",
      { domain: `e2e${Date.now().toString().slice(-6)}.example.com`, type: "custom", sslEnabled: true },
      authHeader(token),
    );
    // Feature flag: 400 "Custom domains are disabled" when off; 201 when on.
    expect([201, 400]).toContain(status);
    if (status === 400) expect(body.message).toMatch(/disabled/i);
  });

  test("GET /custom-domains/domains/:id/status -> 400 on non-uuid id (validateUuid)", async () => {
    const { status } = await httpGet("/custom-domains/domains/not-a-uuid/status", authHeader(token));
    expect(status).toBe(400);
  });
});
