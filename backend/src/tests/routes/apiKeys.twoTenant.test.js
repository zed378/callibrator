/**
 * Two tenants — every /api-keys/:id route (CLAUDE.md: "Every new :id route
 * needs a two-tenant test asserting 404").
 *
 * REAL router, denyApiKey, rbac, validateUuid, controller and apiKey service
 * on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/apiKeys.route.js GET /:id
 * @two-tenant api/apiKeys.route.js DELETE /:id
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/apiKeys.route");

const KEY_A = "a1000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("ApiKey", {
    id: KEY_A,
    tenantId: fx.tenantA.id,
    name: "LIS integration",
    keyPrefix: "clb_live_abcd",
    keyHash: "0".repeat(64),
    scopes: ["calibration:read"],
    isActive: true,
    createdBy: ctx.owner.id,
  });
});

twoTenantSuite({
  module: "api-keys",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => KEY_A },
    { key: "DELETE /:id", method: "DELETE", path: (id) => `/${id}`, id: () => KEY_A, writes: ["ApiKey"] },
  ],
});
