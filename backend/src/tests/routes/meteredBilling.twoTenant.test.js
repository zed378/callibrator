/**
 * Two tenants — DELETE /metered-billing/alerts/:alertId (CLAUDE.md: "Every
 * new :id route needs a two-tenant test asserting 404").
 *
 * REAL router, dynamicAccess (role matrix granted), validateUuid, controller
 * and meteredBilling service on the REAL models and tenant hooks
 * (fixtures/memoryDb).
 *
 * @two-tenant api/meteredBilling.route.js DELETE /alerts/:alertId
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/meteredBilling.route");

const ALERT_A = "a1000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("UsageAlert", {
    id: ALERT_A,
    tenantId: fx.tenantA.id,
    metricName: "api_calls",
    threshold: 1000,
    comparison: "gte",
    notificationChannels: ["email"],
    isEnabled: true,
  });
});

twoTenantSuite({
  module: "metered-billing",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "DELETE /alerts/:alertId", method: "DELETE", path: (id) => `/alerts/${id}`, id: () => ALERT_A, writes: ["UsageAlert"] },
  ],
});
