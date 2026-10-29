/**
 * Two tenants — every /maintenance/:orderId route (CLAUDE.md: "Every new :id
 * route needs a two-tenant test asserting 404").
 *
 * REAL router, validateUuid, dynamicAccess (checkTenant real; role matrix
 * granted), validate, controller, maintenance service, attachment service and
 * audit service on the REAL models and tenant hooks (fixtures/memoryDb). The
 * work order's includes (device, vendor, assignee) are resolved from the real
 * associations.
 *
 * @two-tenant api/maintenance.route.js GET /:orderId
 * @two-tenant api/maintenance.route.js PATCH /:orderId
 * @two-tenant api/maintenance.route.js DELETE /:orderId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/maintenance.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/maintenance.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const ORDER_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId: fx.tenantA.id, name: "Ventilator A", serialNumber: "SN-V-1" });
  mdb.seed("MaintenanceWorkOrder", {
    id: ORDER_A,
    tenantId: fx.tenantA.id,
    deviceId: DEVICE_A,
    title: "Replace filter",
    type: "Preventative",
    status: "Open",
    priority: "Medium",
  });
});

twoTenantSuite({
  module: "maintenance",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:orderId", method: "GET", path: (id) => `/${id}`, id: () => ORDER_A },
    {
      key: "PATCH /:orderId",
      method: "PATCH",
      path: (id) => `/${id}`,
      id: () => ORDER_A,
      body: { status: "InProgress" },
      writes: ["MaintenanceWorkOrder", "AuditLog"],
    },
    { key: "DELETE /:orderId", method: "DELETE", path: (id) => `/${id}`, id: () => ORDER_A, writes: ["MaintenanceWorkOrder", "AuditLog"] },
  ],
});
