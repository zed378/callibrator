/**
 * Two tenants — every /calibration-records/:calibrationRecordId route
 * (CLAUDE.md: "Every new :id route needs a two-tenant test asserting 404").
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted),
 * denyPlatformAuthoring, controller, calibrationRecords service and audit
 * service on the REAL models and tenant hooks (fixtures/memoryDb). The
 * correction and the void lock the record with an unscoped, non-paranoid
 * lookup (so a voided record can be explained as a 409): that lookup still
 * passes through the tenant hook, which is what keeps tenant B out.
 *
 * @two-tenant api/calibrationRecords.route.js GET /:calibrationRecordId
 * @two-tenant api/calibrationRecords.route.js POST /:calibrationRecordId/corrections
 * @two-tenant api/calibrationRecords.route.js POST /:calibrationRecordId/void
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/calibrationRecords.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/calibrationRecords.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const RECORD_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId: fx.tenantA.id, name: "Infusion pump A", serialNumber: "SN-A-1" });
  mdb.seed("CalibrationRecord", {
    id: RECORD_A,
    tenantId: fx.tenantA.id,
    deviceId: DEVICE_A,
    performedBy: ctx.owner.id,
    calibrationDate: new Date("2026-09-01"),
    isCompliant: true,
    notes: "Within tolerance",
  });
});

const REASON = { reason: "Transcription error in the recorded results" };

twoTenantSuite({
  module: "calibration-records",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:calibrationRecordId", method: "GET", path: (id) => `/${id}`, id: () => RECORD_A },
    {
      key: "POST /:calibrationRecordId/corrections",
      method: "POST",
      path: (id) => `/${id}/corrections`,
      id: () => RECORD_A,
      body: { ...REASON, notes: "Corrected reading" },
      writes: ["CalibrationRecord", "AuditLog"],
    },
    {
      key: "POST /:calibrationRecordId/void",
      method: "POST",
      path: (id) => `/${id}/void`,
      id: () => RECORD_A,
      body: REASON,
      writes: ["CalibrationRecord", "AuditLog"],
    },
  ],
});
