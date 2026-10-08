/**
 * P20-06 — UD-4 (b): a TECHNICIAN or HEALTHCARE TECHNICIAN holds `calibration` write on the SEEDED
 * matrix, so the device register's write routes open to them; restore and reinstate stay a tenant
 * administrator's (`rbac([TENANT_ADMIN])`); a SUPERVISOR (equipment read only) is still refused
 * (spec MEMORY/specs/P18-01-02 § 3.2, § 5).
 *
 * REAL: the router, `dynamicAccess` and `rbac`, the controller, service, audit service, models and
 * tenant hooks over memoryDb, and the permission matrix — the real seed (`seedMenuGroups` +
 * `ROLE_MENU_ASSIGNMENTS`) read back by the real `roles.service#getRolePermissionsMatrix`
 * (fixtures/seededMatrix). Nothing here grants a menu by hand.
 *
 * Fail-before: without the two `[MENU_SLUGS.CALIBRATION]: write` rows in ROLE_MENU_ASSIGNMENTS the
 * technicians' create / edit / delete / bulk-import answer 403 (equipment read reaches
 * `calibration` as read only).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/calibrationDevices.route";
import { seedRealMatrix, withSeededRole } from "../fixtures/seededMatrix";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/calibrationDevices.route");

const DEVICE = "a1000000-0000-4000-8000-0000000000d1";
const DELETED = "a1000000-0000-4000-8000-0000000000d2";
const SELF = "50505050-5050-4050-8050-5050505050d1";

let technician: Principal;
let healthcareTechnician: Principal;
let supervisor: Principal;
let admin: Principal;
/** Writes made by the seed itself; a test's own writes come after. */
let seeded = 0;
const testWrites = (): unknown[] => mdb.committed().slice(seeded);

beforeEach(async () => {
  mdb.reset();
  const fx = twoTenants();
  technician = withSeededRole(fx.principal(fx.tenantA, "TECHNICIAN"));
  healthcareTechnician = withSeededRole(fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"));
  supervisor = withSeededRole(fx.principal(fx.tenantA, "SUPERVISOR"));
  admin = withSeededRole(fx.principal(fx.tenantA, "HEALTCARE_ADMIN"));
  seedTenants(mdb, fx, [technician, healthcareTechnician, supervisor, admin]);
  await seedRealMatrix(mdb);
  mdb.seed("ClientFacility", { id: SELF, tenantId: fx.tenantA.id, name: "Self", code: "SELF", isSelf: true, status: "active" });
  mdb.seed("CalibrationDevice", [
    { id: DEVICE, tenantId: fx.tenantA.id, clientFacilityId: SELF, name: "Infusion pump", serialNumber: "SN-UD4B-1", status: "active" },
    {
      id: DELETED,
      tenantId: fx.tenantA.id,
      clientFacilityId: SELF,
      name: "Deleted pump",
      serialNumber: "SN-UD4B-2",
      status: "active",
      isDeleted: true,
    },
  ]);
  seeded = mdb.committed().length;
});

describe.each([
  ["TECHNICIAN", (): Principal => technician],
  ["HEALTHCARE TECHNICIAN", (): Principal => healthcareTechnician],
])("UD-4 (b) — %s on the seeded matrix", (_name, who) => {
  it("creates a device (201) with its audit row", async () => {
    as(who());
    const res = await call(router, "POST", "/", { body: { name: "Syringe pump", serialNumber: "SN-UD4B-NEW" } });
    expect(res.status).toBe(201);
    expect(mdb.committed().slice(seeded).map((w) => w.model)).toEqual(expect.arrayContaining(["CalibrationDevice", "AuditLog"]));
  });

  it("edits a device (200)", async () => {
    as(who());
    const res = await call(router, "PUT", `/${DEVICE}`, { body: { name: "Renamed pump" } });
    expect(res.status).toBe(200);
  });

  it("deletes a device (200)", async () => {
    as(who());
    const res = await call(router, "DELETE", `/${DEVICE}`);
    expect(res.status).toBe(200);
  });

  it("passes the bulk-import gate (no file is a 400 from the handler, not a 403)", async () => {
    as(who());
    const res = await call(router, "POST", "/bulk-import");
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
  });

  it("restore and reinstate stay a tenant administrator's (403)", async () => {
    as(who());
    expect((await call(router, "POST", `/${DELETED}/restore`)).status).toBe(403);
    expect((await call(router, "POST", `/${DEVICE}/reinstate`, { body: { reason: "Retired in error", status: "active" } })).status).toBe(403);
    expect(testWrites()).toEqual([]);
  });
});

describe("UD-4 (b) does not widen the other roles", () => {
  it("a SUPERVISOR (equipment read) is still refused a create (403) and nothing is written", async () => {
    as(supervisor);
    const res = await call(router, "POST", "/", { body: { name: "Syringe pump", serialNumber: "SN-UD4B-SUP" } });
    expect(res.status).toBe(403);
    expect(testWrites()).toEqual([]);
  });

  it("the tenant administrator still restores (positive control for the rbac gate)", async () => {
    as(admin);
    const res = await call(router, "POST", `/${DELETED}/restore`);
    expect(res.status).toBe(200);
  });
});
