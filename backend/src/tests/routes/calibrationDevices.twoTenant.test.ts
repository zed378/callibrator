/**
 * Two tenants — GET, PUT and DELETE /calibration-devices/:calibrationDeviceId
 * (CLAUDE.md: "Every new :id route needs a two-tenant test asserting 404").
 * POST /:calibrationDeviceId/restore is covered by
 * services/calibrationDevices.restore.a133.test.js.
 *
 * Through the REAL router, validateUuid, dynamicAccess (checkTenant real; the
 * role matrix granted), controller, service, attachment.service and
 * audit.service, on the REAL models with the REAL tenant hooks (memoryDb).
 * Tenant B's administrator asking for tenant A's device gets the answer an id
 * that does not exist gets, and no table changes — the audit table included.
 *
 * @two-tenant api/calibrationDevices.route.js GET /:calibrationDeviceId
 * @two-tenant api/calibrationDevices.route.js PUT /:calibrationDeviceId
 * @two-tenant api/calibrationDevices.route.js DELETE /:calibrationDeviceId
 */
import type { Router } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, RouteResponse, TwoTenantWorld } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, as, call, seedTenants, grantAllMenus, probeCrossTenant } =
    jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { MISSING_ID } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<Router>("../../routes/api/calibrationDevices.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";

let fx: TwoTenantWorld;
let adminA: Principal;
let adminB: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  adminB = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [adminA, adminB]);
  mdb.seed("CalibrationDevice", {
    id: DEVICE_A,
    tenantId: fx.tenantA.id,
    name: "Infusion pump A",
    serialNumber: "SN-A-1",
    status: "active",
  });
});

interface DeviceRoute {
    readonly name: string;
    readonly method: string;
    readonly body: unknown;
}

const ROUTES: readonly DeviceRoute[] = [
  { name: "GET /:calibrationDeviceId", method: "GET", body: {} },
  { name: "PUT /:calibrationDeviceId", method: "PUT", body: { name: "Renamed pump", serialNumber: "SN-NEW" } },
  { name: "DELETE /:calibrationDeviceId", method: "DELETE", body: {} },
];

describe.each(ROUTES.map((r) => [r.name, r] as const))("calibration-devices %s — two tenants", (_name, route) => {
  it("another tenant's device answers 404, identical to one that does not exist, and nothing is written", async () => {
    as(adminB);
    const probe = await probeCrossTenant(mdb, (id: string) => call(router, route.method, `/${id}`, { body: route.body }), DEVICE_A, MISSING_ID);

    expect(probe.foreign.status).toBe(404);
    expect(probe.foreign.body).toEqual(probe.missing.body);
    expect(probe.tablesAfter).toEqual(probe.tablesBefore);
    expect(probe.committed).toEqual([]);
  });

  it("the owning tenant reaches it (and a change is written with its audit row)", async () => {
    as(adminA);
    const res: RouteResponse = await call(router, route.method, `/${DEVICE_A}`, { body: route.body });

    expect(res.status).toBe(200);
    if (route.method !== "GET") {
      expect(mdb.committed().map((w) => w.model)).toEqual(expect.arrayContaining(["CalibrationDevice", "AuditLog"]));
    }
  });
});
