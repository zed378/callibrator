/**
 * Two tenants — GET /jobs/:id (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404").
 *
 * REAL router, dynamicAccess (role matrix granted), controller and batchJob
 * service on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/batchJobs.route.js GET /:id
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/batchJobs.route");

const JOB_A = "a1000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("BatchJob", { id: JOB_A, tenantId: fx.tenantA.id, userId: ctx.owner.id, type: "BULK_IMPORT", status: "COMPLETED" });
});

twoTenantSuite({
  module: "jobs",
  router,
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => JOB_A }],
});
