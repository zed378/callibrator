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
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/meteredBilling.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/meteredBilling.route");

const ALERT_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
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
