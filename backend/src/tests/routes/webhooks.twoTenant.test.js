/**
 * Two tenants — every /webhooks/:id route (CLAUDE.md: "Every new :id route
 * needs a two-tenant test asserting 404").
 *
 * REAL router, denyApiKey, rbac, validateUuid, validate, controller and
 * webhook service on the REAL models and tenant hooks (fixtures/memoryDb).
 * Doubled: the outbound HTTP (global fetch) and the webhook service's one raw
 * SQL statement, the delivery claim (answered by `onQuery`, which asserts the
 * claim carries the caller's tenant — raw SQL bypasses the hooks).
 *
 * @two-tenant api/webhooks.route.ts GET /:id
 * @two-tenant api/webhooks.route.ts PATCH /:id
 * @two-tenant api/webhooks.route.ts DELETE /:id
 * @two-tenant api/webhooks.route.ts GET /:id/deliveries
 * @two-tenant api/webhooks.route.ts POST /:id/test
 * @two-tenant api/webhooks.route.ts POST /:id/rotate-secret
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/webhooks.route");

const HOOK_A = "a1000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Webhook", {
    id: HOOK_A,
    tenantId: fx.tenantA.id,
    url: "https://receiver.hospital-a.example.com/hook",
    events: ["certificate.signed"],
    secret: "sealed-secret",
    isActive: true,
    createdBy: ctx.owner.id,
  });
  // The claim is the only raw SQL on these paths. It must name the tenant.
  mdb.onQuery((sql, options) => {
    // P9-18: the claim is sent through sql() — the tenant is bound as $4.
    expect(sql).toContain("tenant_id = $4");
    expect(options.bind[3]).toBe(fx.tenantA.id);
    return []; // nothing claimed: the test delivery stays pending
  });
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, text: async () => "" });
});

const route = (key, method, path, extra = {}) => ({ key, method, path, id: () => HOOK_A, ...extra });

twoTenantSuite({
  module: "webhooks",
  router,
  mdb,
  context: () => ctx,
  routes: [
    route("GET /:id", "GET", (id) => `/${id}`),
    route("PATCH /:id", "PATCH", (id) => `/${id}`, { body: { description: "Renamed" }, writes: ["Webhook"] }),
    route("DELETE /:id", "DELETE", (id) => `/${id}`, { writes: ["Webhook"] }),
    route("GET /:id/deliveries", "GET", (id) => `/${id}/deliveries`),
    route("POST /:id/test", "POST", (id) => `/${id}/test`, { writes: ["WebhookDelivery"] }),
    route("POST /:id/rotate-secret", "POST", (id) => `/${id}/rotate-secret`, { writes: ["Webhook", "AuditLog"] }),
  ],
});
