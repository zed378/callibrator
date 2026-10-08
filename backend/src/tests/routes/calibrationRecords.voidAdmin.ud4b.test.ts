/**
 * P20-06 — the one gate narrowed in the release that gives the technicians `calibration` write
 * (spec MEMORY/specs/P18-01-02 § 4.3): `POST /calibration-records/:id/void` is a tenant
 * administrator's act (`rbac([TENANT_ADMIN])` before `dynamicAccess("calibration", "write")`).
 * A technician still CORRECTS (a new superseding record — the original is kept).
 *
 * REAL: the router, gates, controller, service, audit service, models and tenant hooks over
 * memoryDb, and the permission matrix from the real seed (fixtures/seededMatrix).
 *
 * Fail-before: without the rbac gate the technician's void reached the handler (200 on a live
 * record) — the first case.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/calibrationRecords.route";
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
const router = jest.requireActual<typeof RouteModule>("../../routes/api/calibrationRecords.route");

const DEVICE = "a1000000-0000-4000-8000-0000000000e1";
const RECORD = "a2000000-0000-4000-8000-0000000000e1";
const SELF = "50505050-5050-4050-8050-5050505050e1";
const REASON = { reason: "Transcription error in the recorded results" };

let technician: Principal;
let healthcareTechnician: Principal;
let admin: Principal;
let seeded = 0;
const testWrites = (): string[] => mdb.committed().slice(seeded).map((w) => w.model);

beforeEach(async () => {
  mdb.reset();
  const fx = twoTenants();
  technician = withSeededRole(fx.principal(fx.tenantA, "TECHNICIAN"));
  healthcareTechnician = withSeededRole(fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"));
  admin = withSeededRole(fx.principal(fx.tenantA, "HEALTCARE_ADMIN"));
  seedTenants(mdb, fx, [technician, healthcareTechnician, admin]);
  await seedRealMatrix(mdb);
  mdb.seed("ClientFacility", { id: SELF, tenantId: fx.tenantA.id, name: "Self", code: "SELF", isSelf: true, status: "active" });
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: fx.tenantA.id, clientFacilityId: SELF, name: "Infusion pump", serialNumber: "SN-VOID-1" });
  mdb.seed("CalibrationRecord", {
    id: RECORD,
    tenantId: fx.tenantA.id,
    clientFacilityId: SELF,
    deviceId: DEVICE,
    performedBy: admin.id,
    calibrationDate: new Date("2026-09-01"),
    isCompliant: true,
    notes: "Within tolerance",
  });
  seeded = mdb.committed().length;
});

describe.each([
  ["TECHNICIAN", (): Principal => technician],
  ["HEALTHCARE TECHNICIAN", (): Principal => healthcareTechnician],
])("%s holding calibration write (UD-4 (b))", (_name, who) => {
  it("is refused the void (403) and nothing is written", async () => {
    as(who());
    const res = await call(router, "POST", `/${RECORD}/void`, { body: REASON });
    expect(res.status).toBe(403);
    expect(testWrites()).toEqual([]);
  });

  it("still corrects the record (201: a new superseding record, with its audit row)", async () => {
    as(who());
    const res = await call(router, "POST", `/${RECORD}/corrections`, { body: { ...REASON, notes: "Corrected reading" } });
    expect(res.status).toBe(201);
    expect(testWrites()).toEqual(expect.arrayContaining(["CalibrationRecord", "AuditLog"]));
  });
});

describe("the tenant administrator", () => {
  it("voids a live record (200) with its audit row", async () => {
    as(admin);
    const res = await call(router, "POST", `/${RECORD}/void`, { body: REASON });
    expect(res.status).toBe(200);
    expect(testWrites()).toEqual(expect.arrayContaining(["CalibrationRecord", "AuditLog"]));
  });

  it("a second void is a 409 (a void is final)", async () => {
    as(admin);
    expect((await call(router, "POST", `/${RECORD}/void`, { body: REASON })).status).toBe(200);
    expect((await call(router, "POST", `/${RECORD}/void`, { body: REASON })).status).toBe(409);
  });

  it("an API key is still refused (403), whatever its scopes", async () => {
    as({ ...admin, isApiKey: true, apiKeyScopes: ["calibration:write"] });
    expect((await call(router, "POST", `/${RECORD}/void`, { body: REASON })).status).toBe(403);
  });
});
