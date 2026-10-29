/**
 * Two tenants — every /stocks/:stockId, /stocks/transfer/:transferId and
 * /stocks/opname/:opnameId route (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404").
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted), controller,
 * stock service and workflow service (the pending-approval lookup of A-202),
 * on the REAL models and tenant hooks (fixtures/memoryDb).
 *
 * TypeScript without jest's hoisting (jest.transform.js runs no hoist plugin):
 * the mocks are registered first, then every runtime module is loaded with
 * `jest.requireActual`, typed through an erased `import type`.
 *
 * @two-tenant api/stock.route.js GET /:stockId
 * @two-tenant api/stock.route.js PATCH /:stockId
 * @two-tenant api/stock.route.js DELETE /:stockId
 * @two-tenant api/stock.route.js PATCH /transfer/:transferId
 * @two-tenant api/stock.route.js PATCH /opname/:opnameId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as StockRoute from "../../routes/api/stock.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>(
  "../fixtures/routeClient",
);
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof StockRoute>("../../routes/api/stock.route");

const WAREHOUSE_A = "a1000000-0000-4000-8000-000000000001";
const WAREHOUSE_A2 = "a1000000-0000-4000-8000-000000000002";
const STOCK_A = "a2000000-0000-4000-8000-000000000001";
const TRANSFER_A = "a3000000-0000-4000-8000-000000000001";
const OPNAME_A = "a4000000-0000-4000-8000-000000000001";
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
  const tenantId = fx.tenantA.id;
  mdb.seed("Warehouse", [
    { id: WAREHOUSE_A, tenantId, name: "Main store A", code: "WH-A" },
    { id: WAREHOUSE_A2, tenantId, name: "Ward store A", code: "WH-A2" },
  ]);
  mdb.seed("Stock", { id: STOCK_A, tenantId, warehouseId: WAREHOUSE_A, itemName: "Fuse 5A", quantity: 10 });
  mdb.seed("StockTransfer", {
    id: TRANSFER_A,
    tenantId,
    fromWarehouseId: WAREHOUSE_A,
    toWarehouseId: WAREHOUSE_A2,
    itemName: "Fuse 5A",
    quantity: 2,
    status: "pending",
    requestedBy: ctx.owner.id,
  });
  mdb.seed("StockOpname", { id: OPNAME_A, tenantId, warehouseId: WAREHOUSE_A, status: "draft", performedBy: ctx.owner.id });
});

twoTenantSuite({
  module: "stocks",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:stockId", method: "GET", path: (id: string) => `/${id}`, id: () => STOCK_A },
    { key: "PATCH /:stockId", method: "PATCH", path: (id: string) => `/${id}`, id: () => STOCK_A, body: { description: "Spare fuses" }, writes: ["Stock"] },
    { key: "DELETE /:stockId", method: "DELETE", path: (id: string) => `/${id}`, id: () => STOCK_A, writes: ["Stock"] },
    {
      key: "PATCH /transfer/:transferId",
      method: "PATCH",
      path: (id: string) => `/transfer/${id}`,
      id: () => TRANSFER_A,
      body: { status: "in_transit" },
      writes: ["StockTransfer"],
    },
    {
      key: "PATCH /opname/:opnameId",
      method: "PATCH",
      path: (id: string) => `/opname/${id}`,
      id: () => OPNAME_A,
      body: { status: "in_progress" },
      writes: ["StockOpname"],
    },
  ],
});
