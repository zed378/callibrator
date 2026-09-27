/**
 * Two tenants — every /finance/:financeId route (CLAUDE.md: "Every new :id
 * route needs a two-tenant test asserting 404").
 *
 * REAL router, validateUuid, dynamicAccess (checkTenant real; role matrix
 * granted), validate, controller and finance service on the REAL models and
 * tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/finance.route.js GET /:financeId
 * @two-tenant api/finance.route.js PATCH /:financeId
 * @two-tenant api/finance.route.js DELETE /:financeId
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/finance.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const FINANCE_A = "a2000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId: fx.tenantA.id, name: "Ventilator A", serialNumber: "SN-V-1" });
  mdb.seed("AssetFinance", {
    id: FINANCE_A,
    tenantId: fx.tenantA.id,
    deviceId: DEVICE_A,
    purchasePrice: 10000,
    purchaseDate: new Date("2024-01-01"),
    salvageValue: 1000,
    usefulLifeYears: 5,
    depreciationMethod: "straight_line",
  });
});

twoTenantSuite({
  module: "finance",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:financeId", method: "GET", path: (id) => `/${id}`, id: () => FINANCE_A },
    { key: "PATCH /:financeId", method: "PATCH", path: (id) => `/${id}`, id: () => FINANCE_A, body: { notes: "Audited" }, writes: ["AssetFinance"] },
    { key: "DELETE /:financeId", method: "DELETE", path: (id) => `/${id}`, id: () => FINANCE_A, writes: ["AssetFinance"] },
  ],
});
