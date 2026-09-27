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

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { seedTenants, grantAllMenus } = require("../fixtures/routeClient");
const { twoTenantSuite } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/maintenance.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const ORDER_A = "a2000000-0000-4000-8000-000000000001";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  ctx.other = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
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
