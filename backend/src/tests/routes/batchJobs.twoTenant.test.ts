/**
 * Two tenants — GET /jobs/:id (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404").
 *
 * REAL router, dynamicAccess (role matrix granted), controller and batchJob
 * service on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/batchJobs.route.ts GET /:id
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/batchJobs.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/batchJobs.route");

const JOB_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
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
