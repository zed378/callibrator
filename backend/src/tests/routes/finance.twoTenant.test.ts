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
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/finance.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/finance.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const FINANCE_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
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
