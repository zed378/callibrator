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
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/supplierScorecard.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/supplierScorecard.route");

const VENDOR_A = "a1000000-0000-4000-8000-000000000001";
const CARD_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
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
