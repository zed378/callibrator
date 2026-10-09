/**
 * P21-02a — the device register's write rules (ADR-132 § 1, § 4 – § 7; spec P19-03 § 4 – § 6,
 * § 8.1, § 13: `calibrationDevices.qr.p2102`, `.facilityRequired.p2102`, `deviceRooms.p2102`,
 * `calibrationDevice.condition.p2102` in one suite):
 *
 *  - the QR: normalised with the tenant's prefix and digits, unique per tenant over every row; the
 *    409 `DEVICE_QR_TAKEN` names the holder and its facility (or that it is deleted); the race's
 *    unique violation is the same 409; cleared and changed with the audit row's before/after;
 *  - the bound contract: no QR, status or vendor (strict 400) — a bound user provokes no QR 409;
 *  - the facility: never changed by an edit (400), the same facility is no change;
 *  - rooms: found or created by name and floor in the device's facility (one room, not two), a
 *    room of another facility is a 400, a store is accepted, a bound technician's room is its
 *    facility's; stock refuses a room; the warehouse list filters by kind;
 *  - the inventory date, the laboratory (in context), the condition's source, the registrant;
 *  - the offline reference (`clientRef`) and `Idempotency-Key` replay a create.
 *
 * REAL: the routers' chains (auth double → tenant context + facility gate, dynamicAccess,
 * validateScoped, idempotency), controllers, services, models and the tenant + facility hooks over
 * memoryDb. Synthetic data only (QR prefix `TST`).
 */
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as StockRoute from "../../routes/api/stock.route";
import type * as WarehouseRoute from "../../routes/api/warehouse.route";
import type * as Models from "../../models";
import type DeviceService from "../../services/calibrationDevices.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
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
const stock = jest.requireActual<typeof StockRoute>("../../routes/api/stock.route");
const warehouses = jest.requireActual<typeof WarehouseRoute>("../../routes/api/warehouse.route");
const models = jest.requireActual<typeof Models>("../../models");
const deviceService = jest.requireActual<typeof DeviceService>("../../services/calibrationDevices.service");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");

interface Res {
  status: number;
  body: { data?: Record<string, unknown> | Record<string, unknown>[] | null; message?: string; code?: string; holderId?: string };
}

const VENDOR = "0e0e0e0e-0000-4000-8000-0000000000a1";
const VENDOR_B = "0e0e0e0e-0000-4000-8000-0000000000b1";
const DELETED = "d1000000-0000-4000-8000-0000000000de";
const REF = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", [
    { tenantId: world.tenantA, key: "device_qr_code_prefix", value: "TST" },
    { tenantId: world.tenantA, key: "device_qr_code_digits", value: "6" },
    { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" },
  ]);
  mdb.seed("Vendor", [
    { id: VENDOR, tenantId: world.tenantA, name: "Lab Sintetis", type: "CalibrationLab", status: "active", approvalStatus: "approved" },
    { id: VENDOR_B, tenantId: world.tenantB, name: "Lab B", type: "CalibrationLab", status: "active", approvalStatus: "approved" },
  ]);
  mdb.seed("CalibrationDevice", { id: DELETED, tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat terhapus", qrCode: "TST000099", status: "active", isDeleted: true, deletedAt: new Date("2026-09-01T00:00:00Z") });
});

const devicesCall = (principal: Principal, method: string, url: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Res> => {
  as(principal);
  return call(devices, method, url, { body, headers, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" }) as Promise<Res>;
};
const create = (principal: Principal, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Res> =>
  devicesCall(principal, "POST", "/", { clientFacilityId: IPM.F1, ...body }, headers);
const one = (res: Res): Record<string, unknown> => res.body.data as Record<string, unknown>;
const stored = (id: unknown): Record<string, unknown> => mdb.rows("CalibrationDevice").find((d) => d["id"] === id) as Record<string, unknown>;
const audits = (operation?: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((a) => operation === undefined || (a["changes"] as { operation?: string } | null)?.operation === operation);

describe("the QR code (spec § 4.2, § 4.3)", () => {
  it("is normalised with the tenant's prefix and digits", async () => {
    const res = await create(world.staff, { name: "Pompa 42", qrCode: " 42 " });
    expect(res.status).toBe(201);
    expect(stored(one(res)["id"])["qrCode"]).toBe("TST000042");
  });

  it("a QR another device holds is a 409 naming it and its facility", async () => {
    const res = await create(world.staff, { name: "Pompa dup", qrCode: "1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEVICE_QR_TAKEN");
    expect(res.body.holderId).toBe(IPM.D1);
    expect(res.body.message).toBe("QR code TST000001 is already on device Alat sintetis 1 in Facility One.");
  });

  it("a QR a deleted device holds stays reserved: a 409 that says so", async () => {
    const res = await create(world.staff, { name: "Pompa dup", qrCode: "TST000099" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("QR code TST000099 is on a deleted device (Alat terhapus); restore it, or use another sticker.");
  });

  it("a malformed QR or too many digits is a 400", async () => {
    expect((await create(world.staff, { name: "Pompa", qrCode: "1234567" })).body.message).toBe("This QR number is longer than 6 digits.");
    expect((await create(world.staff, { name: "Pompa", qrCode: "-A" })).status).toBe(400);
  });

  it("the unique index's race is the same 409", async () => {
    jest.spyOn(models.CalibrationDevice, "create").mockImplementationOnce(() => {
      mdb.seed("CalibrationDevice", { id: "d1000000-0000-4000-8000-0000000000aa", tenantId: world.tenantA, clientFacilityId: IPM.F2, name: "Alat balapan", qrCode: "TST000077", status: "active", isDeleted: false });
      throw new UniqueConstraintError({ fields: { qr_code: "TST000077" } });
    });
    const res = await create(world.staff, { name: "Pompa", qrCode: "77" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("QR code TST000077 is already on device Alat balapan in Facility Two.");
  });

  it("an edit keeps its own QR, refuses another's, clears it, and audits before/after", async () => {
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { qrCode: "tst000001" })).status).toBe(200);
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { qrCode: "2" })).body.code).toBe("DEVICE_QR_TAKEN");
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { qrCode: null })).status).toBe(200);
    expect(stored(IPM.D1)["qrCode"]).toBeNull();
    const last = audits().filter((a) => a["action"] === "UPDATE").at(-1) as { changes: { before: Record<string, unknown>; after: Record<string, unknown> } };
    expect(last.changes.before["qrCode"]).toBe("TST000001");
    expect(last.changes.after["qrCode"]).toBeNull();
  });

  it("a blank QR is no QR", async () => {
    const res = await create(world.staff, { name: "Pompa", qrCode: "   " });
    expect(res.status).toBe(201);
    expect(stored(one(res)["id"])["qrCode"] ?? null).toBeNull();
  });
});

describe("the bound contract (spec § 5; OQ-2, FT-50)", () => {
  it.each([[{ qrCode: "1" }], [{ status: "active" }], [{ calibrationVendorId: VENDOR }], [{ tenantId: IPM.F1 }]])("a bound create or edit with %j is a 400", async (extra) => {
    expect((await devicesCall(world.bound, "POST", "/", { name: "Pompa", ...extra })).status).toBe(400);
    expect((await devicesCall(world.bound, "PUT", `/${IPM.D1}`, extra)).status).toBe(400);
  });

  it("a bound technician registers a device with a room of its own facility", async () => {
    const res = await devicesCall(world.bound, "POST", "/", { name: "Pompa F1", room: { name: "Ruang Baru", floor: "2" }, condition: "good" });
    expect(res.status).toBe(201);
    const row = stored(one(res)["id"]);
    expect(row["clientFacilityId"]).toBe(IPM.F1);
    const room = mdb.rows("Warehouse").find((w) => w["id"] === row["locationId"]) as Record<string, unknown>;
    expect(room).toMatchObject({ kind: "room", clientFacilityId: IPM.F1, name: "Ruang Baru", floor: "2" });
    expect(row["createdBy"]).toBe(IPM.BOUND);
    expect(typeof (row["registrantSnapshot"] as { name?: unknown }).name).toBe("string");
  });

  it("a bound location of another facility is the same 404 as a missing one", async () => {
    expect((await devicesCall(world.bound, "POST", "/", { name: "Pompa", locationId: IPM.ROOM2 })).body.message).toBe("Location not found");
  });
});

describe("the facility (spec § 8.1; AM-6)", () => {
  it("an edit cannot change it; naming the same facility is no change", async () => {
    const moved = await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { clientFacilityId: IPM.F2 });
    expect(moved.status).toBe(400);
    expect(moved.body.message).toBe("A device changes facility only through a move. Move the device instead.");
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { clientFacilityId: IPM.F1, name: "Alat sintetis 1b" })).status).toBe(200);
  });

  it("an ended facility takes no new device (409 DEVICE_FACILITY_ENDED)", async () => {
    mdb.seed("ClientFacility", { id: "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3", tenantId: world.tenantA, name: "Facility Ended", code: "F-0003", status: "ended" });
    const res = await create(world.staff, { name: "Pompa", clientFacilityId: "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEVICE_FACILITY_ENDED");
  });
});

describe("rooms (spec § 6.2, § 6.3; UD-10)", () => {
  it("finds or creates one room by name and floor (case and spaces folded), audited", async () => {
    const a = await create(world.staff, { name: "Pompa A", room: { name: " ruang   baru ", floor: "Lt 2" } });
    const b = await create(world.staff, { name: "Pompa B", room: { name: "RUANG BARU", floor: "lt 2" } });
    expect(stored(one(a)["id"])["locationId"]).toBe(stored(one(b)["id"])["locationId"]);
    const rooms = mdb.rows("Warehouse").filter((w) => w["kind"] === "room" && w["clientFacilityId"] === IPM.F1);
    expect(rooms.map((r) => r["name"]).sort()).toEqual(["Ruang 1", "ruang baru"]);
    expect(audits("CREATE_ROOM_FROM_DEVICE")).toHaveLength(1);
  });

  it("a room name is matched literally: `_` and `%` are not wildcards", async () => {
    const a = await create(world.staff, { name: "Pompa", room: { name: "R_1%" } });
    const b = await create(world.staff, { name: "Pompa", room: { name: "RX1Z" } });
    expect(stored(one(a)["id"])["locationId"]).not.toBe(stored(one(b)["id"])["locationId"]);
    const again = await create(world.staff, { name: "Pompa", room: { name: "r_1%" } });
    expect(stored(one(again)["id"])["locationId"]).toBe(stored(one(a)["id"])["locationId"]);
  });

  it("an existing room of the device's facility is found (Ruang 1), a floor makes another room", async () => {
    const res = await create(world.staff, { name: "Pompa", room: { name: "ruang 1" } });
    expect(stored(one(res)["id"])["locationId"]).toBe(IPM.ROOM1);
    const other = await create(world.staff, { name: "Pompa", room: { name: "ruang 1", floor: "3" } });
    expect(stored(one(other)["id"])["locationId"]).not.toBe(IPM.ROOM1);
  });

  it("a room of another facility is a 400; a store is accepted; a missing one is a 404", async () => {
    expect((await create(world.staff, { name: "Pompa", locationId: IPM.ROOM2 })).body.message).toBe("This room belongs to another facility.");
    expect((await create(world.staff, { name: "Pompa", locationId: IPM.STORE1 })).status).toBe(201);
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { locationId: IPM.ROOM2 })).status).toBe(400);
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { locationId: "" })).status).toBe(200);
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { locationId: "a0000000-0000-4000-8000-0000000000ff" })).status).toBe(404);
  });

  it("a room created by a concurrent request first is a 409 to save again; another failure propagates", async () => {
    jest.spyOn(models.Warehouse, "create").mockImplementationOnce(() => {
      throw new UniqueConstraintError({ fields: { name: "Ruang Balap" } });
    });
    const raced = await create(world.staff, { name: "Pompa", room: { name: "Ruang Balap" } });
    expect([raced.status, raced.body.code]).toEqual([409, "ROOM_CREATED_CONCURRENTLY"]);
    jest.spyOn(models.Warehouse, "create").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect((await create(world.staff, { name: "Pompa", room: { name: "Ruang Balap" } })).status).toBe(500);
  });

  it("stock refuses a room; the warehouse list filters by kind", async () => {
    as(world.staff);
    const refused = (await call(stock, "POST", "/", { body: { warehouseId: IPM.ROOM1, itemName: "Selang" }, routeFile: "api/stock.route.ts" })) as Res;
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe("Rooms hold devices, not stock.");
    as(world.staff);
    const stores = (await call(warehouses, "GET", "/", { query: { kind: "store" }, routeFile: "api/warehouse.route.ts" })) as Res;
    expect((stores.body.data as Record<string, unknown>[]).map((w) => w["id"])).toEqual([IPM.STORE1]);
  });
});

describe("the other register fields (spec § 4.1, § 4.4)", () => {
  it("an inventory date in the future is a 400; today is accepted", async () => {
    expect((await create(world.staff, { name: "Pompa", inventoriedOn: "2999-01-01" })).body.message).toBe("An inventory date cannot be in the future.");
    expect((await create(world.staff, { name: "Pompa", inventoriedOn: "2024-01-01" })).status).toBe(201);
  });

  it("the laboratory is a vendor of the tenant (another tenant's is a 404)", async () => {
    expect((await create(world.staff, { name: "Pompa", calibrationVendorId: VENDOR_B })).body.message).toBe("Vendor not found");
    const res = await create(world.staff, { name: "Pompa", calibrationVendorId: VENDOR });
    expect(stored(one(res)["id"])["calibrationVendorId"]).toBe(VENDOR);
  });

  it("the condition records its source and when: registration, then manual", async () => {
    const res = await create(world.staff, { name: "Pompa", condition: "good" });
    const id = one(res)["id"];
    expect(stored(id)).toMatchObject({ condition: "good", conditionSource: "registration" });
    expect(stored(id)["conditionChangedAt"]).toBeTruthy();
    await devicesCall(world.staff, "PUT", `/${String(id)}`, { condition: "not_good" });
    expect(stored(id)).toMatchObject({ condition: "not_good", conditionSource: "manual" });
    await devicesCall(world.staff, "PUT", `/${String(id)}`, { condition: null });
    expect(stored(id)["conditionSource"] ?? null).toBeNull();
  });

  it("the registrant and its snapshot are taken at create; a typed date is `manual`", async () => {
    const res = await create(world.staff, { name: "Pompa", nextCalibrationDate: "2027-01-01T00:00:00.000Z" });
    const row = stored(one(res)["id"]);
    expect(row["createdBy"]).toBe(world.staff.id);
    expect(typeof (row["registrantSnapshot"] as { name?: unknown }).name).toBe("string");
    expect(row["nextCalibrationDateSource"]).toBe("manual");
  });
});

describe("offline replays (ADR-127 § 7)", () => {
  it("the same creator's clientRef answers its device (200), once", async () => {
    const first = await create(world.staff, { name: "Pompa", clientRef: REF });
    const again = await create(world.staff, { name: "Pompa", clientRef: REF });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(one(again)["id"]).toBe(one(first)["id"]);
    expect(mdb.rows("CalibrationDevice").filter((d) => d["clientRef"] === REF)).toHaveLength(1);
  });

  it("a clientRef with no person is a 400; a collision the caller cannot read is a 409", async () => {
    // An API key (no person): the service refuses the reference (its CHECK needs a creator).
    const keyed = await deviceService.createCalibrationDevice(world.tenantA as never, { name: "Pompa", clientRef: REF }, { apiKeyId: "0a0a0a0a-0000-4000-8000-0000000000a1" });
    expect(keyed.status).toBe(400);
    jest.spyOn(models.CalibrationDevice, "create").mockImplementationOnce(() => {
      throw new UniqueConstraintError({ fields: { client_ref: REF } });
    });
    const res = await create(world.staff, { name: "Pompa", clientRef: REF });
    expect(res.body.code).toBe("DEVICE_CLIENT_REF_REUSED");
  });

  it("an Idempotency-Key replays the create: one device, the same id", async () => {
    const headers = { "Idempotency-Key": "9b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" };
    const first = await create(world.staff, { name: "Pompa idem" }, headers);
    const again = await create(world.staff, { name: "Pompa idem" }, headers);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(one(again)["id"]).toBe(one(first)["id"]);
    expect(mdb.rows("CalibrationDevice").filter((d) => d["name"] === "Pompa idem")).toHaveLength(1);
  });
});

describe("the remaining branches (races, a facility-less holder, the service's own bound check)", () => {
  it("an edit's QR race is the same 409", async () => {
    jest.spyOn(models.CalibrationDevice.prototype, "update").mockImplementationOnce(() => {
      mdb.seed("CalibrationDevice", { id: "d1000000-0000-4000-8000-0000000000ab", tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat balapan 2", qrCode: "TST000078", status: "active", isDeleted: false });
      throw new UniqueConstraintError({ fields: { qr_code: "TST000078" } });
    });
    const res = await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { qrCode: "78" });
    expect([res.status, res.body.message]).toEqual([409, "QR code TST000078 is already on device Alat balapan 2 in Facility One."]);
  });

  it("a holder with no facility is named without one", async () => {
    mdb.seed("CalibrationDevice", { id: "d1000000-0000-4000-8000-0000000000ac", tenantId: world.tenantA, name: "Alat tanpa fasilitas", qrCode: "TST000055", status: "active", isDeleted: false });
    expect((await create(world.staff, { name: "Pompa", qrCode: "55" })).body.message).toBe("QR code TST000055 is already on device Alat tanpa fasilitas.");
  });

  it("a tenant with no facility to name creates the room without one (the database's default trigger decides)", async () => {
    const res = await devicesCall(world.other, "POST", "/", { name: "Pompa B", room: { name: "Ruang B" } });
    expect(res.status).toBe(201);
  });

  it("the service refuses a bound edit's status even when called directly", async () => {
    const outcome = await tenantStorage.run({ tenantId: world.tenantA as never, isSuperAdmin: false, isSystemTask: false, userId: IPM.BOUND, clientFacilityId: IPM.F1 as never, facilityBound: true }, () =>
      deviceService.updateCalibrationDevice(world.tenantA as never, IPM.D1, { status: "inactive" }, { userId: IPM.BOUND }),
    );
    expect([outcome.status, outcome.message]).toEqual([400, "A facility user cannot change a device's status."]);
  });

  it("a replayed create whose device is gone from view is the 404", async () => {
    const headers = { "Idempotency-Key": "9b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e" };
    const first = await create(world.staff, { name: "Pompa hilang" }, headers);
    expect(first.status).toBe(201);
    jest.spyOn(models.CalibrationDevice, "findOne").mockResolvedValueOnce(null);
    expect((await create(world.staff, { name: "Pompa hilang" }, headers)).status).toBe(404);
  });
});

describe("the last branches (P21-02a)", () => {
  it("a QR violation with no holder left propagates (500) on create and on edit", async () => {
    jest.spyOn(models.CalibrationDevice, "create").mockImplementationOnce(() => {
      throw new UniqueConstraintError({ fields: { qr_code: "TST000079" } });
    });
    expect((await create(world.staff, { name: "Pompa", qrCode: "79" })).status).toBe(500);
    jest.spyOn(models.CalibrationDevice.prototype, "update").mockImplementationOnce(() => {
      throw new UniqueConstraintError({ fields: { qr_code: "TST000079" } });
    });
    expect((await devicesCall(world.staff, "PUT", `/${IPM.D1}`, { qrCode: "79" })).status).toBe(500);
  });

  it("clearing the date clears its source", async () => {
    const res = await create(world.staff, { name: "Pompa", nextCalibrationDate: "2027-01-01T00:00:00.000Z" });
    await devicesCall(world.staff, "PUT", `/${String(one(res)["id"])}`, { nextCalibrationDate: null });
    expect(stored(one(res)["id"])["nextCalibrationDateSource"] ?? null).toBeNull();
  });

  it("a malformed QR filter is a 400 (a refusal, not a failure); a blank QR looks nothing up", async () => {
    as(world.staff);
    const listed = (await call(devices, "GET", "/", { query: { qrCode: "-x" }, routeFile: "api/calibrationDevices.route.ts", baseUrl: "/api/v1/calibration-devices" })) as Res;
    expect(listed.status).toBe(400);
    const blank = await tenantStorage.run({ tenantId: world.tenantA as never, isSuperAdmin: false, isSystemTask: false }, () => deviceService.fetchCalibrationDeviceByQr(world.tenantA as never, "   "));
    expect(blank.status).toBe(404);
  });
});
