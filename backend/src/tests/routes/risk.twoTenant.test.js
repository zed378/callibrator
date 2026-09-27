/**
 * Two tenants — every /risk/:id route (CLAUDE.md: "Every new :id route needs
 * a two-tenant test asserting 404").
 *
 * REAL risk router, dynamicAccess (role matrix granted), controller and
 * service, on the REAL models and tenant hooks (fixtures/memoryDb). The
 * service's include of the identifying and assigned users is resolved from
 * the real associations.
 *
 * @two-tenant api/risk.route.js GET /:id
 * @two-tenant api/risk.route.js PUT /:id
 * @two-tenant api/risk.route.js DELETE /:id
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/risk.route");

const RISK_A = "a1000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Risk", {
    id: RISK_A,
    tenantId: fx.tenantA.id,
    title: "Pump alarm failure",
    severity: 3,
    likelihood: 2,
    identifiedBy: ctx.owner.id,
  });
});

twoTenantSuite({
  module: "risk",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => RISK_A },
    { key: "PUT /:id", method: "PUT", path: (id) => `/${id}`, id: () => RISK_A, body: { status: "MITIGATED" }, writes: ["Risk"] },
    { key: "DELETE /:id", method: "DELETE", path: (id) => `/${id}`, id: () => RISK_A, writes: ["Risk"] },
  ],
});
