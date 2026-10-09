/**
 * P21-05 — the quick external-calibration entry (ADR-133 § 2; spec P19-05 § 7.3 row by row, § 10,
 * § 12 `calibrationDates.p2105` and `calibrationDates.bound`):
 *  - 201: an `external_date` record with the laboratory (vendor and/or name as printed), the
 *    performer's snapshot, the room confirmed at entry; the device's date re-derived; NO file;
 *  - 404 for a device not in context (deleted; another tenant's in `calibrationDates.twoTenant`);
 *    409 `CALIBRATION_DEVICE_RETIRED`, `CALIBRATION_FACILITY_ENDED`; 400 for a future date, a date
 *    before 1990, a due date not after the date, no laboratory named by a person, a room of
 *    another facility; 404 for another tenant's vendor;
 *  - a same-day entry is accepted with a notice (history is never refused);
 *  - an API key records as `api_key_id` with no performer snapshot and may omit the laboratory;
 *  - an IPM's calibration request is cleared by an entry dated on or after it;
 *  - one transaction: a failing audit insert leaves no record, no device change, no audit row;
 *  - a facility-bound technician holding `calibration` write is refused 403 before a parameter
 *    is read, the same for a valid and an invalid id (N-10, C-14, G-10).
 *
 * REAL: the router's chain (auth double → tenant context + facility route gate, dynamicAccess,
 * denyPlatformAuthoring, validate, idempotency), the controller, services, models and hooks over
 * memoryDb. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as AuditModule from "../../services/audit.service";
import type * as DatesModule from "../../services/calibrationDates.service";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");
const auditService = jest.requireActual<typeof AuditModule>("../../services/audit.service");
const dates = jest.requireActual<typeof DatesModule>("../../services/calibrationDates.service");
const recordsRouter = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");
const db = mdb.sequelize;

type Row = Record<string, unknown>;
interface Res {
  status: number;
  body: { data?: Row | null; message?: string; code?: string };
}

const VENDOR = "0e0e0e0e-0000-4000-8000-0000000000a1";
const VENDOR_B = "0e0e0e0e-0000-4000-8000-0000000000b1";
const KEY_ID = "ab000000-0000-4000-8000-0000000000c1";

let world: IpmWorld;
let d1: Row;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" });
  mdb.seed("Vendor", [
    { id: VENDOR, tenantId: world.tenantA, name: "Lab Sintetis", type: "CalibrationLab", status: "active", approvalStatus: "approved" },
    { id: VENDOR_B, tenantId: world.tenantB, name: "Lab B", type: "CalibrationLab", status: "active", approvalStatus: "approved" },
  ]);
  d1 = mdb.seed("CalibrationDevice", { id: "d1000000-0000-4000-8000-0000000000c1", tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat C1", status: "active", calibrationIntervalDays: 365, isDeleted: false })[0] as Row;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const entry = (principal: Principal, body: Row, deviceId: string = d1["id"] as string): Promise<Res> => {
  as(principal);
  return call(devices, "POST", `/${deviceId}/calibration-dates`, { body, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" }) as Promise<Res>;
};
const records = (): Row[] => mdb.rows("CalibrationRecord").filter((r) => r["deviceId"] === d1["id"]);
const ok = { calibrationDate: "2026-09-01", calibrationVendorId: VENDOR };
const apiKey = (): Principal =>
  ({
    id: KEY_ID,
    username: "integration",
    tenantId: world.tenantA,
    tenant: { id: world.tenantA, name: "Tenant A", status: "ACTIVE" },
    role: { id: "", name: "API_KEY", roleLevel: 0 },
    isActive: true,
    status: "ACTIVE",
    isApiKey: true,
    apiKeyScopes: ["calibration:write"],
  });

describe("201: the record, the derived date, the room (§ 7.3)", () => {
  it("records the external date with the vendor's name, the performer, the room; derives the device's date", async () => {
    const res = await entry(world.staff, { ...ok, dueDate: "2027-08-15", certificateNumber: "C-001", isCompliant: true, room: { name: "ruang 1" } });
    expect(res.status).toBe(201);
    const body = res.body.data as Row;
    expect(body).toMatchObject({
      entryKind: "external_date",
      calibrationVendorId: VENDOR,
      externalLabName: "Lab Sintetis",
      roomSnapshot: "Ruang 1",
      certificateNumber: "C-001",
      isCompliant: true,
      notices: [],
    });
    expect((body["performerSnapshot"] as { name?: unknown }).name).toMatch(/\S/);
    expect(body["device"]).toMatchObject({ nextCalibrationDateSource: "record" });
    expect(new Date(d1["nextCalibrationDate"] as Date).toISOString()).toBe("2027-08-15T00:00:00.000Z");
    expect(d1["locationId"]).toBe(IPM.ROOM1);
    const ops = mdb.rows("AuditLog").map((a) => (a["changes"] as { operation?: string } | null)?.operation);
    expect(ops).toEqual(expect.arrayContaining(["RECORD_EXTERNAL_CALIBRATION", "DERIVE_NEXT_CALIBRATION_DATE", "CALIBRATION_ENTRY_ROOM"]));
    expect(records()).toHaveLength(1);
    expect(new Date(records()[0]?.["calibrationDate"] as Date).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("a typed laboratory name with no vendor; the interval derives the date", async () => {
    const res = await entry(world.staff, { calibrationDate: "2026-09-01", externalLabName: "Lab Luar" });
    expect(res.status).toBe(201);
    expect((res.body.data as Row)["externalLabName"]).toBe("Lab Luar");
    expect(new Date(d1["nextCalibrationDate"] as Date).toISOString()).toBe("2027-09-01T00:00:00.000Z");
  });

  it("a same-day entry is accepted with a notice", async () => {
    await entry(world.staff, ok);
    const again = await entry(world.staff, ok);
    expect(again.status).toBe(201);
    expect((again.body.data as Row)["notices"]).toEqual([expect.stringMatching(/^A calibration on this date is already recorded \(by .+\)\.$/) as unknown as string]);
    expect(records()).toHaveLength(2);
  });

  it("a same-day entry after a key's entry (no snapshot) names no person", async () => {
    await entry(apiKey(), { calibrationDate: "2026-09-01" });
    const again = await entry(world.staff, ok);
    expect((again.body.data as Row)["notices"]).toEqual(["A calibration on this date is already recorded (by another entry)."]);
  });

  it("clears an IPM's calibration request dated on or before the entry", async () => {
    Object.assign(d1, { calibrationRequestedAt: new Date("2026-08-20T09:00:00Z"), calibrationRequestedBySessionId: IPM.S1 });
    await entry(world.staff, { ...ok, calibrationDate: "2026-08-01" });
    expect(d1["calibrationRequestedAt"]).toBeTruthy();
    await entry(world.staff, { ...ok, calibrationDate: "2026-08-20" });
    expect(d1["calibrationRequestedAt"] ?? null).toBeNull();
    expect(mdb.rows("AuditLog").some((a) => (a["changes"] as { operation?: string } | null)?.operation === "IPM_CALIBRATION_REQUEST_CLEARED")).toBe(true);
  });

  it("an API key records as the key, with no performer snapshot, and may omit the laboratory", async () => {
    const res = await entry(apiKey(), { calibrationDate: "2026-09-01" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ apiKeyId: KEY_ID, performedBy: null, performerSnapshot: null, externalLabName: null });
  });
});

describe("the refusals (§ 7.3)", () => {
  it("a deleted device is the 404 of a missing one", async () => {
    Object.assign(d1, { isDeleted: true });
    const gone = await entry(world.staff, ok);
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual((await entry(world.staff, ok, "d1000000-0000-4000-8000-0000000000ff")).body);
  });

  it("a retired device: 409 CALIBRATION_DEVICE_RETIRED", async () => {
    Object.assign(d1, { status: "retired" });
    const res = await entry(world.staff, ok);
    expect([res.status, res.body.code]).toEqual([409, "CALIBRATION_DEVICE_RETIRED"]);
  });

  it("an ended facility: 409 CALIBRATION_FACILITY_ENDED", async () => {
    mdb.seed("ClientFacility", { id: "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3", tenantId: world.tenantA, name: "Facility Ended", code: "F-0003", status: "ended" });
    Object.assign(d1, { clientFacilityId: "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3" });
    const res = await entry(world.staff, ok);
    expect([res.status, res.body.code]).toEqual([409, "CALIBRATION_FACILITY_ENDED"]);
  });

  it.each([
    [{ calibrationDate: "2999-01-01" }, "A calibration date cannot be in the future."],
    [{ calibrationDate: "1989-12-31" }, "A calibration date is on or after 1990-01-01."],
  ])("%j is a 400", async (body, message) => {
    const res = await entry(world.staff, { ...ok, ...body });
    expect([res.status, res.body.message]).toEqual([400, message]);
  });

  it("a due date not after the date, no laboratory, another tenant's vendor, another facility's room", async () => {
    expect((await entry(world.staff, { ...ok, dueDate: "2026-09-01" })).status).toBe(400);
    expect((await entry(world.staff, { calibrationDate: "2026-09-01" })).body.message).toBe("Name the laboratory that calibrated the device.");
    expect((await entry(world.staff, { ...ok, calibrationVendorId: VENDOR_B })).body.message).toBe("Vendor not found");
    expect((await entry(world.staff, { ...ok, locationId: IPM.ROOM2 })).body.message).toBe("This room belongs to another facility.");
    expect(records()).toHaveLength(0);
  });

  it("one transaction: a failing audit insert leaves no record, no device change, no audit row", async () => {
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("audit insert failed"));
    const before = { ...d1 };
    const res = await entry(world.staff, { ...ok, room: { name: "Ruang 1" } });
    expect(res.status).toBe(500);
    expect(records()).toHaveLength(0);
    expect(d1["nextCalibrationDate"] ?? null).toEqual(before["nextCalibrationDate"] ?? null);
    expect(mdb.committed().filter((w) => ["CalibrationRecord", "AuditLog", "CalibrationDevice"].includes(w.model))).toEqual([]);
  });
});

describe("not facility-accessible (N-10, C-14, G-10)", () => {
  it("a bound technician with `calibration` write is refused before a parameter is read", async () => {
    const valid = await entry(world.bound, ok, IPM.D1);
    const invalid = await entry(world.bound, { nonsense: true }, "not-a-uuid");
    expect(valid.status).toBe(403);
    expect(valid.body.code).toBe("FACILITY_ROUTE_REFUSED");
    expect(invalid.body).toEqual(valid.body);
  });
});

describe("the remaining branches", () => {
  it("an Idempotency-Key replays the entry (one record); a record gone from view is the 404", async () => {
    const headers = { "Idempotency-Key": "9b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5f" };
    as(world.staff);
    const first = (await call(devices, "POST", `/${String(d1["id"])}/calibration-dates`, { body: ok, headers, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" })) as Res;
    as(world.staff);
    const again = (await call(devices, "POST", `/${String(d1["id"])}/calibration-dates`, { body: ok, headers, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" })) as Res;
    expect([first.status, again.status]).toEqual([201, 201]);
    expect((again.body.data as Row)["id"]).toBe((first.body.data as Row)["id"]);
    expect(records()).toHaveLength(1);
    await expect(dates.readCalibrationRecord("e1000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({ status: 404 });
  });

  it("re-deriving a device not in context changes nothing", async () => {
    const t = await db.transaction();
    await expect(dates.rederiveNextCalibrationDate(world.tenantA, "d1000000-0000-4000-8000-0000000000ff", { recordId: null, newRecord: false }, {}, t)).resolves.toBeNull();
    await t.rollback();
  });

  it("a correction of an external date cannot add results (400)", async () => {
    const created = await entry(world.staff, ok);
    as(world.staff);
    const res = (await call(recordsRouter, "POST", `/${String((created.body.data as Row)["id"])}/corrections`, {
      body: { standard: "Ref-1", reason: "add the standard" },
      routeFile: "api/calibrationRecords.route.ts",
      baseUrl: "/api/v1/calibration-records",
    })) as Res;
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^This record is an outside laboratory's calibration date/);
    const fixed = (await call(recordsRouter, "POST", `/${String((created.body.data as Row)["id"])}/corrections`, {
      body: { calibrationDate: "2026-09-02T00:00:00.000Z", reason: "the date was misread" },
      routeFile: "api/calibrationRecords.route.ts",
      baseUrl: "/api/v1/calibration-records",
    })) as Res;
    expect(fixed.status).toBe(201);
    expect(fixed.body.data).toMatchObject({ entryKind: "external_date", externalLabName: "Lab Sintetis", calibrationVendorId: VENDOR });
  });
});
