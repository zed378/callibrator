/**
 * Two tenants — every /api-keys/:id route (CLAUDE.md: "Every new :id route
 * needs a two-tenant test asserting 404").
 *
 * REAL router, denyApiKey, rbac, validateUuid, controller and apiKey service
 * on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/apiKeys.route.js GET /:id
 * @two-tenant api/apiKeys.route.js DELETE /:id
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/apiKeys.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/apiKeys.route");

const KEY_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("ApiKey", {
    id: KEY_A,
    tenantId: fx.tenantA.id,
    name: "LIS integration",
    keyPrefix: "clb_live_abcd",
    keyHash: "0".repeat(64),
    scopes: ["calibration:read"],
    isActive: true,
    createdBy: ctx.owner.id,
  });
});

twoTenantSuite({
  module: "api-keys",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => KEY_A },
    { key: "DELETE /:id", method: "DELETE", path: (id) => `/${id}`, id: () => KEY_A, writes: ["ApiKey"] },
  ],
});
