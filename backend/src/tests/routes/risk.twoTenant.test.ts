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
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/risk.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/risk.route");

const RISK_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = {
    owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"),
    other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN"),
  };
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
    { key: "GET /:id", method: "GET", path: (id: string) => `/${id}`, id: () => RISK_A },
    { key: "PUT /:id", method: "PUT", path: (id: string) => `/${id}`, id: () => RISK_A, body: { status: "MITIGATED" }, writes: ["Risk"] },
    { key: "DELETE /:id", method: "DELETE", path: (id: string) => `/${id}`, id: () => RISK_A, writes: ["Risk"] },
  ],
});
