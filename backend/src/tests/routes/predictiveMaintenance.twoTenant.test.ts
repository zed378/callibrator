/**
 * Two tenants — POST /predictive-maintenance/analyze/:deviceId (CLAUDE.md:
 * "Every new :id route needs a two-tenant test asserting 404"). The approve
 * route is covered by partElevenAuthoring.a145.test.js.
 *
 * REAL router, validateUuid, dynamicAccess (checkTenant real; role matrix
 * granted), controller, predictiveMaintenance service and audit service on
 * the REAL models and tenant hooks (fixtures/memoryDb). The owner's device has
 * 20 readings, 5 of them anomalous, so the analysis writes a recommendation,
 * a notification and an audit row.
 *
 * @two-tenant api/predictiveMaintenance.route.ts POST /analyze/:deviceId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/predictiveMaintenance.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/predictiveMaintenance.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", {
    id: DEVICE_A,
    tenantId: fx.tenantA.id,
    name: "Fridge A",
    serialNumber: "SN-F-1",
    iotEnabled: true,
    calibrationIntervalDays: 180,
  });
  mdb.seed(
    "IotReading",
    Array.from({ length: 20 }, (_, i) => ({
      tenantId: fx.tenantA.id,
      deviceId: DEVICE_A,
      timestamp: new Date(Date.now() - (i + 1) * 3600_000),
      metrics: { temperature: 4 + i / 10 },
      isAnomaly: i < 5,
    })),
  );
});

twoTenantSuite({
  module: "predictive-maintenance",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "POST /analyze/:deviceId",
      method: "POST",
      path: (id) => `/analyze/${id}`,
      id: () => DEVICE_A,
      writes: ["CalibrationDevice", "Notification", "AuditLog"],
    },
  ],
});
