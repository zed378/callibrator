/**
 * Two tenants — GET /gdpr/erasure/:requestId (CLAUDE.md: "Every new :id route
 * needs a two-tenant test asserting 404"). controllers/gdpr.erasureStatus.a252
 * pins the controller's own rule (subject or privacy officer) with the
 * service doubled; this drives the whole route.
 *
 * The probe is tenant B's PRIVACY OFFICER (an administrator holding `gdpr`
 * read — the widest reader of erasure requests there is) asking for tenant
 * A's request id. The owner is tenant A's privacy officer.
 *
 * REAL router, validateUuid, controller, gdpr service and dynamicAccess's
 * principalHasMenuPermission (role matrix granted) on the REAL models and
 * tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/gdpr.route.ts GET /erasure/:requestId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/gdpr.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/gdpr.route");

const REQUEST_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  const subject = fx.principal(fx.tenantA, "USER");
  seedTenants(mdb, fx, [ctx.owner, ctx.other, subject]);
  mdb.seed("DsarRequest", {
    id: REQUEST_A,
    tenantId: fx.tenantA.id,
    userId: subject.id,
    type: "erasure",
    status: "pending",
    requestedAt: new Date("2026-09-20"),
  });
});

twoTenantSuite({
  module: "gdpr",
  router,
  mdb,
  context: () => ctx,
  routes: [{ key: "GET /erasure/:requestId", method: "GET", path: (id) => `/erasure/${id}`, id: () => REQUEST_A }],
});
