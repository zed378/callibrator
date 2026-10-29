/**
 * Two tenants — every /warehouses/:warehouseId and /warehouses/locations/
 * :locationId route (CLAUDE.md: "Every new :id route needs a two-tenant test
 * asserting 404").
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted), controller
 * and service, on the REAL models and tenant hooks (fixtures/memoryDb). For
 * GET /:warehouseId/locations the foreign answer is the 404 a missing
 * warehouse gets — not a 200 carrying tenant A's locations, nor an empty list.
 *
 * @two-tenant api/warehouse.route.js GET /:warehouseId
 * @two-tenant api/warehouse.route.js PATCH /:warehouseId
 * @two-tenant api/warehouse.route.js DELETE /:warehouseId
 * @two-tenant api/warehouse.route.js GET /:warehouseId/locations
 * @two-tenant api/warehouse.route.js PATCH /locations/:locationId
 * @two-tenant api/warehouse.route.js DELETE /locations/:locationId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/warehouse.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/warehouse.route");

const WAREHOUSE_A = "a1000000-0000-4000-8000-000000000001";
const LOCATION_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Warehouse", { id: WAREHOUSE_A, tenantId: fx.tenantA.id, name: "Main store A", code: "WH-A", status: "active" });
  mdb.seed("StorageLocation", { id: LOCATION_A, tenantId: fx.tenantA.id, warehouseId: WAREHOUSE_A, name: "Shelf 1", code: "S1" });
});

twoTenantSuite({
  module: "warehouses",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:warehouseId", method: "GET", path: (id) => `/${id}`, id: () => WAREHOUSE_A },
    { key: "PATCH /:warehouseId", method: "PATCH", path: (id) => `/${id}`, id: () => WAREHOUSE_A, body: { name: "Renamed store" }, writes: ["Warehouse"] },
    { key: "DELETE /:warehouseId", method: "DELETE", path: (id) => `/${id}`, id: () => WAREHOUSE_A, writes: ["Warehouse"] },
    { key: "GET /:warehouseId/locations", method: "GET", path: (id) => `/${id}/locations`, id: () => WAREHOUSE_A },
    { key: "PATCH /locations/:locationId", method: "PATCH", path: (id) => `/locations/${id}`, id: () => LOCATION_A, body: { name: "Shelf 9" }, writes: ["StorageLocation"] },
    { key: "DELETE /locations/:locationId", method: "DELETE", path: (id) => `/locations/${id}`, id: () => LOCATION_A, writes: ["StorageLocation"] },
  ],
});
