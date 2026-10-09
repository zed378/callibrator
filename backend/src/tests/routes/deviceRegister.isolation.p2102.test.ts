/**
 * P21-02a / P21-05 — the isolation of the register's new routes (P18-04 A-12, A-14, B-15, C-11):
 *  - two tenants: the QR lookup and the quick calibration entry answer another tenant's principal
 *    404, identical to a missing QR or device, and write nothing; the owner reaches each one;
 *  - two facilities: the QR lookup and the warehouse reads (A-9, now marked) answer a bound F1
 *    principal 404 for F2's device or room, identical to a missing one; the lists hold F1's rows
 *    only (a provider store with no facility is never listed for it).
 *
 * The quick entry is NOT facility-accessible (N-10): its bound refusal (403 before a parameter is
 * read) is in `calibrationDates.p2105`.
 *
 * @two-tenant api/calibrationDevices.route.ts GET /by-qr/:qrCode
 * @two-tenant api/calibrationDevices.route.ts POST /:calibrationDeviceId/calibration-dates
 * @two-facility api/calibrationDevices.route.ts GET /by-qr/:qrCode
 * @two-facility api/warehouse.route.ts GET /:warehouseId
 *
 * REAL: the routers' chains, controllers, services, models and the tenant + facility hooks over
 * memoryDb. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as TenantSuite from "../fixtures/twoTenantSuite";
import type * as FacilitySuite from "../fixtures/twoFacilitySuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { FacilitySuiteContext } from "../fixtures/twoFacilitySuite";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as WarehouseRoute from "../../routes/api/warehouse.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof TenantSuite>("../fixtures/twoTenantSuite");
const { twoFacilitySuite, MISSING_FACILITY_ROW } = jest.requireActual<typeof FacilitySuite>("../fixtures/twoFacilitySuite");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");
const warehouses = jest.requireActual<typeof WarehouseRoute>("../../routes/api/warehouse.route");

/** A QR no device holds: the suites' "missing id" for the lookup (a uuid is no QR: 400). */
const UNKNOWN_QR = "TST000777";
const qrPath = (id: string): string => `/by-qr/${id === MISSING_FACILITY_ROW || id === TenantSuite_MISSING ? UNKNOWN_QR : id}`;
// The two-tenant suite's missing id (twoTenantSuite.MISSING_ID): mapped to an unknown QR as well.
const TenantSuite_MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let world: IpmWorld;
let tenantCtx: SuiteContext;
let facilityCtx: FacilitySuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" });
  tenantCtx = { owner: world.staff, other: world.other };
  facilityCtx = { bound: world.bound, unbound: world.staff };
});

twoTenantSuite({
  module: "calibration-devices (P21-02a / P21-05)",
  router: devices,
  mdb,
  context: () => tenantCtx,
  routes: [
    { key: "GET /by-qr/:qrCode", method: "GET", path: qrPath, id: () => "TST000001" },
    {
      key: "POST /:calibrationDeviceId/calibration-dates",
      method: "POST",
      path: (id) => `/${id}/calibration-dates`,
      id: () => IPM.D1,
      body: { calibrationDate: "2026-09-01", externalLabName: "Lab Sintetis" },
      writes: ["CalibrationRecord", "AuditLog"],
      ownerStatus: 201,
    },
  ],
});

twoFacilitySuite({
  module: "calibration-devices (P21-02a)",
  router: devices,
  routeFile: "api/calibrationDevices.route.ts",
  baseUrl: "/api/v1/calibration-devices",
  mdb,
  context: () => facilityCtx,
  routes: [{ key: "GET /by-qr/:qrCode", method: "GET", path: qrPath, ownId: () => "TST000001", foreignId: () => "TST000002", unboundToo: true }],
});

twoFacilitySuite({
  module: "warehouses (P21-02a, A-9)",
  router: warehouses,
  routeFile: "api/warehouse.route.ts",
  baseUrl: "/api/v1/warehouses",
  mdb,
  context: () => facilityCtx,
  routes: [{ key: "GET /:warehouseId", method: "GET", path: (id) => `/${id}`, ownId: () => IPM.ROOM1, foreignId: () => IPM.ROOM2, unboundToo: true }],
  lists: [{ key: "GET /", path: "/", query: { kind: "room" }, ownId: () => IPM.ROOM1, foreignId: () => IPM.ROOM2 }],
});
