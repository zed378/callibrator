/**
 * Two tenants — every /supplier-scorecard/:id route (CLAUDE.md: "Every new
 * :id route needs a two-tenant test asserting 404").
 *
 * REAL router, gates (role matrix granted), controller and service on the
 * REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/supplierScorecard.route.js GET /:id
 * @two-tenant api/supplierScorecard.route.js PUT /:id
 * @two-tenant api/supplierScorecard.route.js DELETE /:id
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/supplierScorecard.route");

const VENDOR_A = "a1000000-0000-4000-8000-000000000001";
const CARD_A = "a2000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: fx.tenantA.id, name: "Lab A" });
  mdb.seed("SupplierScorecard", {
    id: CARD_A,
    tenantId: fx.tenantA.id,
    vendorId: VENDOR_A,
    evaluationDate: new Date("2026-09-01"),
    qualityScore: 80,
    deliveryScore: 70,
    serviceScore: 90,
    evaluatedBy: ctx.owner.id,
  });
});

twoTenantSuite({
  module: "supplier-scorecard",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => CARD_A },
    { key: "PUT /:id", method: "PUT", path: (id) => `/${id}`, id: () => CARD_A, body: { qualityScore: 95 }, writes: ["SupplierScorecard"] },
    { key: "DELETE /:id", method: "DELETE", path: (id) => `/${id}`, id: () => CARD_A, writes: ["SupplierScorecard"] },
  ],
});
