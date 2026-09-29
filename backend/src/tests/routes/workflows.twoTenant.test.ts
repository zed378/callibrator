/**
 * Two tenants — GET /workflows/:id (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404"). PUT and DELETE /:id are covered by
 * workflows.decision.a182a183.test.js, the instance action by
 * partElevenAuthoring.a145.test.js.
 *
 * REAL router, dynamicAccess (role matrix granted), validateUuid, controller
 * and workflow service (with its steps include) on the REAL models and tenant
 * hooks (fixtures/memoryDb).
 *
 * @two-tenant api/workflows.route.js GET /:id
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/workflows.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/workflows.route");

const WORKFLOW_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Workflow", { id: WORKFLOW_A, tenantId: fx.tenantA.id, name: "Certificate approval", resourceType: "Certificate" });
});

twoTenantSuite({
  module: "workflows",
  router,
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => WORKFLOW_A }],
});
