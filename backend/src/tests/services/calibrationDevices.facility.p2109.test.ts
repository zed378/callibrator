/**
 * P21-09 — hand-offs 1 and 2 of P20-07 (ADR-124 Am. 2 § 1, Am. 3 § 3; UD-9):
 *
 *  1. G-F1 — the service names the facility on EVERY device create, so a tenant with a second
 *     facility no longer meets Am. 3's 23502: an unbound creator naming none gets the tenant's
 *     SELF facility; naming one gets that facility of its tenant (404 for another tenant's or a
 *     missing one; 409 for an `ended` one); a bound creator gets its own (another is a 404).
 *     The bulk import goes to the self facility.
 *  2. UD-9 — the serial pre-check is per FACILITY, as the index is since 0118: the same serial
 *     in two facilities is two instruments; in one facility it is still a 409.
 * Plus spec § 16 (hand-off 3): the device's CREATE audit row is stamped with its facility,
 * resolved by the audit service from the resource.
 *
 * The REAL service, models, hooks and audit service over memoryDb.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as DeviceService from "../../services/calibrationDevices.service";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof DeviceService>("../../services/calibrationDevices.service");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantId;
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TenantId;
const SELF = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F_ENDED = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const F_T2 = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";
const U = "11111111-1111-4111-8111-111111111111";

const ctx = (bound: boolean, over: Partial<TenantContextStore> = {}): TenantContextStore => ({
  tenantId: T,
  isSuperAdmin: false,
  isSystemTask: false,
  userId: U,
  clientFacilityId: (bound ? F1 : null) as ClientFacilityId | null,
  facilityBound: bound,
  ...over,
});

const create = (input: Record<string, unknown>, bound = false): ReturnType<typeof service.createCalibrationDevice> =>
  tenantStorage.run(ctx(bound), () => service.createCalibrationDevice(T, input, { userId: U }));

const devices = (): Record<string, unknown>[] => mdb.rows("CalibrationDevice");

beforeEach(() => {
  mdb.reset();
  mdb.seed("ClientFacility", [
    { id: SELF, tenantId: T, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: F_ENDED, tenantId: T, name: "Facility Ended", code: "F-0003", status: "ended", statusReason: "contract over" },
    { id: F_T2, tenantId: T2, name: "Other Tenant's", code: "F-0009", status: "active" },
  ]);
});

describe("G-F1 — the facility of a new device", () => {
  it("an unbound creator naming none: the tenant's self facility", async () => {
    const out = await create({ name: "Infusion pump" });
    expect(out.status).toBe(201);
    expect(devices()[0]).toMatchObject({ tenantId: T, clientFacilityId: SELF });
  });

  it("an unbound creator naming a facility of its tenant: that facility", async () => {
    const out = await create({ name: "Infusion pump", clientFacilityId: F1 });
    expect(out.status).toBe(201);
    expect(devices()[0]).toMatchObject({ clientFacilityId: F1 });
  });

  it("another tenant's facility, or a missing one: 404, nothing written", async () => {
    for (const id of [F_T2, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]) {
      const out = await create({ name: "Infusion pump", clientFacilityId: id });
      expect(out).toMatchObject({ success: false, status: 404, message: "Client facility not found" });
    }
    expect(devices()).toEqual([]);
  });

  it("an ended facility: 409 with the state explanation (spec § 4.4)", async () => {
    const out = await create({ name: "Infusion pump", clientFacilityId: F_ENDED });
    expect(out).toMatchObject({ status: 409, message: "Facility Ended has ended; new records cannot be added. Reinstate it first." });
    expect(devices()).toEqual([]);
  });

  it("a bound creator: its own facility; naming another answers as a missing one", async () => {
    expect((await create({ name: "Pump" }, true)).status).toBe(201);
    expect(devices()[0]).toMatchObject({ clientFacilityId: F1 });
    expect(await create({ name: "Pump 2", clientFacilityId: SELF }, true)).toMatchObject({ status: 404 });
    expect((await create({ name: "Pump 3", clientFacilityId: F1 }, true)).status).toBe(201);
  });

  it("a tenant without a self facility: the create names none (the database's default trigger decides)", async () => {
    mdb.reset();
    const out = await create({ name: "Pump" });
    expect(out.status).toBe(201);
    expect(devices()[0]?.["clientFacilityId"]).toBeUndefined();
  });

  it("the CREATE audit row is stamped with the device's facility (spec § 16, resolved from the resource)", async () => {
    await create({ name: "Pump", clientFacilityId: F1 });
    const rows = mdb.rows("AuditLog").filter((r) => r["resourceType"] === "CalibrationDevice");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "CREATE", clientFacilityId: F1 });
  });
});

describe("UD-9 — the serial is unique per facility", () => {
  it("the same serial in another facility is accepted; in the same facility it is a 409", async () => {
    expect((await create({ name: "Device A", serialNumber: "SN-1" })).status).toBe(201);
    expect((await create({ name: "Device B", serialNumber: "SN-1", clientFacilityId: F1 })).status).toBe(201);
    const dup = await create({ name: "Device C", serialNumber: "SN-1", clientFacilityId: F1 });
    expect(dup.status).toBe(409);
    expect(devices()).toHaveLength(2);
  });

  it("an edit to a serial another facility holds is accepted; to one its own facility holds, a 409", async () => {
    await create({ name: "Device A", serialNumber: "SN-1" });
    await create({ name: "Device B", serialNumber: "SN-2", clientFacilityId: F1 });
    await create({ name: "Device C", serialNumber: "SN-3", clientFacilityId: F1 });
    const [, b, c] = devices() as { id: string }[];
    const edit = (id: string, serialNumber: string): ReturnType<typeof service.updateCalibrationDevice> =>
      tenantStorage.run(ctx(false), () => service.updateCalibrationDevice(T, id, { serialNumber }, { userId: U }));
    expect((await edit((b as { id: string }).id, "SN-1")).status).toBe(200);
    expect((await edit((c as { id: string }).id, "SN-1")).status).toBe(409);
  });
});

describe("UD-9 — a restore meets only its own facility's live serial", () => {
  const DELETED = "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0";
  const LIVE = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
  const restore = (): ReturnType<typeof service.restoreCalibrationDevice> =>
    tenantStorage.run(ctx(false), () => service.restoreCalibrationDevice(T, DELETED, { userId: U }));

  it("a live device of the same serial in ANOTHER facility does not block the restore", async () => {
    mdb.seed("CalibrationDevice", [
      { id: DELETED, tenantId: T, clientFacilityId: F1, name: "Old pump", serialNumber: "SN-9", status: "active", isDeleted: true },
      { id: LIVE, tenantId: T, clientFacilityId: SELF, name: "Pump", serialNumber: "SN-9", status: "active", isDeleted: false },
    ]);
    expect((await restore()).status).toBe(200);
  });

  it("a live device of the same serial in the SAME facility does (409)", async () => {
    mdb.seed("CalibrationDevice", [
      { id: DELETED, tenantId: T, clientFacilityId: F1, name: "Old pump", serialNumber: "SN-9", status: "active", isDeleted: true },
      { id: LIVE, tenantId: T, clientFacilityId: F1, name: "Pump", serialNumber: "SN-9", status: "active", isDeleted: false },
    ]);
    expect((await restore()).status).toBe(409);
  });
});

describe("G-F1 — a bulk import goes to the self facility, its serials checked there", () => {
  it("imports into the self facility; a serial the self facility holds is a row error, one another facility holds is not", async () => {
    mdb.seed("CalibrationDevice", [
      { id: "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2", tenantId: T, clientFacilityId: SELF, name: "Held", serialNumber: "SN-SELF", status: "active", isDeleted: false },
      { id: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3", tenantId: T, clientFacilityId: F1, name: "Elsewhere", serialNumber: "SN-F1", status: "active", isDeleted: false },
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2109-import-"));
    const csv = path.join(dir, "devices.csv");
    fs.writeFileSync(csv, ["name,serial number", "Pump A,SN-SELF", "Pump B,SN-F1", ""].join("\n"));
    try {
      const out = await tenantStorage.run(ctx(false), () => service.bulkImportCalibrationDevices(T, csv, { userId: U }));
      expect(out.data).toMatchObject({ successCount: 1, failedCount: 1 });
      const imported = devices().find((d) => d["name"] === "Pump B");
      expect(imported).toMatchObject({ clientFacilityId: SELF, serialNumber: "SN-F1" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
