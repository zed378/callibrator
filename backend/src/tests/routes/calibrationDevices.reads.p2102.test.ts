/**
 * P21-02a / P21-05 — what a device read answers (spec P19-03 § 8.2, § 8.3; P19-05 § 6; P19-02 § 11;
 * P19-08 § 7.2): the facts (`ipmDue`, `lastIpm`, the caller's `openIpmDraftId`, `photosComplete`
 * and the photo ids, `calibrationDue`, `lastCalibration`), the displays (registrant, laboratory —
 * whose id a facility reader never gets), the register's filters, "calibration due" as a filter,
 * `?view=field` (exactly the summary's keys, the working set's cap) and the QR lookup (one 404 for
 * unknown, deleted, another facility's and another tenant's QR; PT-31).
 *
 * REAL: the router's chain, controller, services, models and the tenant + facility hooks over
 * memoryDb. The dates are relative to the real clock (the services read `new Date()`). Synthetic
 * data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import { FIELD_DEVICE_SUMMARY_KEYS } from "@callibrator/contracts/deviceValues";
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

type Row = Record<string, unknown>;
interface Res {
  status: number;
  body: { data?: Row | Row[] | null; meta?: Row; message?: string; code?: string };
}

const VENDOR = "0e0e0e0e-0000-4000-8000-0000000000a1";
const DELETED = "d1000000-0000-4000-8000-0000000000de";
const R1 = "e1000000-0000-4000-8000-0000000000f1";
const R1_OLD = "e1000000-0000-4000-8000-0000000000f0";
const R2 = "e1000000-0000-4000-8000-0000000000f2";
const DAY = 86_400_000;
const inDays = (n: number): Date => new Date(Date.now() + n * DAY);

let world: IpmWorld;
let d1: Row;
let d2: Row;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", [
    { tenantId: world.tenantA, key: "device_qr_code_prefix", value: "TST" },
    { tenantId: world.tenantA, key: "ipm_interval_months", value: "1" },
    { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" },
  ]);
  mdb.seed("Vendor", { id: VENDOR, tenantId: world.tenantA, name: "Lab Sintetis", type: "CalibrationLab", status: "active", approvalStatus: "approved" });
  mdb.seed("CalibrationDevice", { id: DELETED, tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat terhapus", qrCode: "TST000099", status: "active", isDeleted: true });
  [d1] = mdb.rows("CalibrationDevice").filter((d) => d["id"] === IPM.D1) as [Row];
  // seed returns the stored rows: re-seed D1 and D2 with the register's fields.
  d1 = mdb.seed("CalibrationDevice", {
    ...d1,
    id: "d1000000-0000-4000-8000-0000000000c1",
    name: "Alat sintetis C1",
    qrCode: "TST000011",
    condition: "good",
    locationId: IPM.ROOM1,
    calibrationVendorId: VENDOR,
    createdBy: world.staff.id,
    registrantSnapshot: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" },
    nextCalibrationDate: inDays(10),
    nextCalibrationDateSource: "record",
  })[0] as Row;
  d2 = mdb.seed("CalibrationDevice", { id: "d1000000-0000-4000-8000-0000000000c2", tenantId: world.tenantA, clientFacilityId: IPM.F2, name: "Alat sintetis C2", qrCode: "TST000012", condition: "broken", status: "active", isDeleted: false, nextCalibrationDate: inDays(-2), nextCalibrationDateSource: "manual" })[0] as Row;
  const C1 = d1["id"] as string;
  mdb.seed("InspectionSession", [
    { ...(mdb.rows("InspectionSession").find((s) => s["id"] === IPM.S1) as Row), id: "5e550000-0000-4000-8000-0000000000c1", deviceId: C1, visitNumber: 4 },
    { ...(mdb.rows("InspectionSession").find((s) => s["id"] === IPM.DRAFT1) as Row), id: "5e550000-0000-4000-8000-0000000001c1", deviceId: C1 },
  ]);
  mdb.seed("Attachment", [
    { id: "a1000000-0000-4000-8000-0000000000c1", tenantId: world.tenantA, clientFacilityId: IPM.F1, resourceType: "device", resourceId: C1, purpose: "device_front", fileName: "f.jpg", originalName: "f.jpg", mimeType: "image/jpeg", size: 3, uploadedBy: world.staff.id },
    { id: "a1000000-0000-4000-8000-0000000000c2", tenantId: world.tenantA, clientFacilityId: IPM.F1, resourceType: "CalibrationDevice", resourceId: C1, purpose: "device_serial_plate", fileName: "s.jpg", originalName: "s.jpg", mimeType: "image/jpeg", size: 3, uploadedBy: world.staff.id },
  ]);
  mdb.seed("CalibrationRecord", [
    { id: R1_OLD, tenantId: world.tenantA, clientFacilityId: IPM.F1, deviceId: C1, performedBy: world.staff.id, calibrationDate: new Date("2025-01-01T00:00:00Z"), entryKind: "full_record" },
    { id: R1, tenantId: world.tenantA, clientFacilityId: IPM.F1, deviceId: C1, performedBy: world.staff.id, calibrationDate: new Date("2026-09-01T00:00:00Z"), entryKind: "external_date", externalLabName: "Lab Sintetis", performerSnapshot: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" } },
    { id: R2, tenantId: world.tenantA, clientFacilityId: IPM.F2, deviceId: d2["id"], performedBy: world.staff.id, calibrationDate: new Date("2026-08-01T00:00:00Z"), entryKind: "full_record" },
  ]);
});

const get = (principal: Principal, url: string, query: Row = {}): Promise<Res> => {
  as(principal);
  return call(devices, "GET", url, { query, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" }) as Promise<Res>;
};
const data = (res: Res): Row => res.body.data as Row;
const ids = (res: Res): unknown[] => (res.body.data as Row[]).map((r) => r["id"]);

describe("one device's facts and displays", () => {
  it("provider staff: every fact, the displays and the vendor's id", async () => {
    const res = await get(world.staff, `/${String(d1["id"])}`);
    expect(res.status).toBe(200);
    const body = data(res);
    expect(body["lastIpm"]).toEqual({ performedAt: "2026-10-01T02:00:00.000Z", visitNumber: 4 });
    expect(body["ipmDue"]).toMatchObject({ dueMonth: "2026-11", intervalMonths: 1 });
    expect(body["openIpmDraftId"]).toBeNull();
    expect(body).toMatchObject({ photosComplete: true, frontPhotoAttachmentId: "a1000000-0000-4000-8000-0000000000c1", serialPlatePhotoAttachmentId: "a1000000-0000-4000-8000-0000000000c2" });
    expect(body["calibrationDue"]).toMatchObject({ state: "due_soon", source: "record", requestedBySessionId: null });
    expect(body["lastCalibration"]).toEqual({
      recordId: R1,
      date: "2026-09-01",
      entryKind: "external_date",
      externalLabName: "Lab Sintetis",
      performerDisplay: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis", redacted: false },
    });
    expect(body["calibrationVendorDisplay"]).toEqual({ name: "Lab Sintetis" });
    expect(body["calibrationVendorId"]).toBe(VENDOR);
    expect(body["registrantDisplay"]).toEqual({ name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" });
    expect(body["warehouse"]).toMatchObject({ id: IPM.ROOM1, kind: "room" });
    expect(body["clientFacility"]).toMatchObject({ id: IPM.F1, name: "Facility One" });
  });

  it("a facility reader: its own draft, the laboratory's NAME only, no registrant id", async () => {
    const body = data(await get(world.bound, `/${String(d1["id"])}`));
    expect(body["openIpmDraftId"]).toBe("5e550000-0000-4000-8000-0000000001c1");
    expect(body["calibrationVendorDisplay"]).toEqual({ name: "Lab Sintetis" });
    for (const key of ["calibrationVendorId", "calibrationVendor", "createdBy", "registrantSnapshot"]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body["registrantDisplay"]).toMatchObject({ name: "Teknisi Sintetis" });
  });

  it("a record with no snapshot shows its performer through the projection; no photos: incomplete", async () => {
    const body = data(await get(world.staff, `/${String(d2["id"])}`));
    expect(body["lastCalibration"]).toMatchObject({ recordId: R2, entryKind: "full_record", performerDisplay: { redacted: false } });
    expect(body).toMatchObject({ photosComplete: false, frontPhotoAttachmentId: null, lastIpm: null, calibrationDue: { state: "overdue" } });
  });
});

describe("the list: filters, calibration due, the field view", () => {
  it("filters by QR (normalised), type, condition, location and facility; sorts by id", async () => {
    expect(ids(await get(world.staff, "/", { qrCode: "11" }))).toEqual([d1["id"]]);
    expect(ids(await get(world.staff, "/", { condition: "broken" }))).toEqual([d2["id"]]);
    expect(ids(await get(world.staff, "/", { locationId: IPM.ROOM1 }))).toEqual([d1["id"]]);
    expect(ids(await get(world.staff, "/", { clientFacilityId: IPM.F2, sort: "id" }))).toEqual([d2["id"], IPM.D2]);
    expect(ids(await get(world.staff, "/", { deviceTypeId: IPM.TYPE, clientFacilityId: IPM.F1 }))).toEqual([IPM.D1, d1["id"]]);
  });

  it("filters by calibration due: overdue, due soon, requested", async () => {
    expect(ids(await get(world.staff, "/", { calibrationDue: "overdue" }))).toEqual([d2["id"]]);
    expect(ids(await get(world.staff, "/", { calibrationDue: "due_soon" }))).toEqual([d1["id"]]);
    expect(ids(await get(world.staff, "/", { calibrationDue: "requested" }))).toEqual([]);
    Object.assign(d2, { calibrationRequestedAt: new Date(), calibrationRequestedBySessionId: IPM.S2 });
    expect(ids(await get(world.staff, "/", { calibrationDue: "requested" }))).toEqual([d2["id"]]);
    expect(ids(await get(world.staff, "/", { calibrationDue: "overdue", status: "active" }))).toEqual([]);
  });

  it("`view=field` answers exactly the summary's keys; a facility reader gets its facility only", async () => {
    const res = await get(world.bound, "/", { view: "field", limit: "200", sort: "id" });
    expect(res.status).toBe(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => r["id"])).toEqual([d1["id"], IPM.D1]);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual([...FIELD_DEVICE_SUMMARY_KEYS]);
    }
    expect(rows[0]).toMatchObject({ openIpmDraftId: "5e550000-0000-4000-8000-0000000001c1", photosComplete: true, lastIpm: { visitNumber: 4 } });
    expect(res.body.meta).toMatchObject({ total: 2 });
  });

  it("a selection above the working set's cap is a 400 narrowed by room", async () => {
    mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "field_working_set_max_devices", value: "1" });
    const res = await get(world.bound, "/", { view: "field" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FIELD_WORKING_SET_TOO_LARGE");
    expect((await get(world.bound, "/", { view: "field", locationId: IPM.ROOM1 })).status).toBe(200);
  });
});

describe("the QR lookup (spec § 8.2; N-13, A-12, C-11, PT-31)", () => {
  it("finds the device by its sticker as scanned or typed", async () => {
    const res = await get(world.staff, "/by-qr/11");
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({ id: d1["id"], qrCode: "TST000011", photosComplete: true });
    expect(data(await get(world.bound, "/by-qr/tst000011"))["id"]).toBe(d1["id"]);
  });

  it("unknown, deleted, another facility's and another tenant's QR: the same 404", async () => {
    const unknown = await get(world.bound, "/by-qr/777");
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe("No device with this QR code.");
    for (const qr of ["99", "12", "TST000002"]) {
      expect(await get(world.bound, `/by-qr/${qr}`)).toEqual(unknown);
    }
    // Tenant B has no prefix: the full sticker of tenant A's device is the 404 of an unknown one.
    expect(await get(world.other, "/by-qr/TST000011")).toEqual(await get(world.other, "/by-qr/TST000777"));
  });

  it("a value that is no QR is a 400", async () => {
    expect((await get(world.staff, "/by-qr/-x")).status).toBe(400);
  });
});

describe("the remaining branches", () => {
  it("a device with no status, a session with no visit number, a key-recorded record: null displays", async () => {
    Object.assign(d2, { status: null });
    mdb.seed("InspectionSession", { ...(mdb.rows("InspectionSession").find((s) => s["id"] === IPM.S2) as Row), id: "5e550000-0000-4000-8000-0000000000c2", deviceId: d2["id"], visitNumber: null, performedAt: new Date("2026-10-05T00:00:00Z") });
    mdb.seed("CalibrationRecord", { id: "e1000000-0000-4000-8000-0000000000f3", tenantId: world.tenantA, clientFacilityId: IPM.F2, deviceId: d2["id"], apiKeyId: "ab000000-0000-4000-8000-0000000000c1", calibrationDate: new Date("2026-09-15T00:00:00Z"), entryKind: "external_date" });
    const body = data(await get(world.staff, `/${String(d2["id"])}`));
    expect(body["lastIpm"]).toEqual({ performedAt: "2026-10-05T00:00:00.000Z", visitNumber: null });
    expect(body["lastCalibration"]).toMatchObject({ recordId: "e1000000-0000-4000-8000-0000000000f3", performerDisplay: null });
    expect(body["calibrationDue"]).toMatchObject({ state: "overdue" });
  });

  it("an API key reads the list with no open draft of its own", async () => {
    const key = { ...world.staff, id: "ab000000-0000-4000-8000-0000000000c1", role: { id: "", name: "API_KEY", roleLevel: 0 }, isApiKey: true, apiKeyScopes: ["calibration:read"] } as unknown as Principal;
    const res = await get(key, "/", { qrCode: "11" });
    expect(res.status).toBe(200);
    expect((res.body.data as Row[])[0]?.["openIpmDraftId"]).toBeNull();
  });
});
