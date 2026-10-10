/**
 * P22-02 — the device form as data (P19-03 § 4 – § 6, § 8.1): the form read from a device, the
 * checks before a round trip, and the exact bodies. A bound writer's bodies NEVER carry `qrCode`,
 * `status`, `calibrationVendorId` or `clientFacilityId` (its contract is strict: each would be a
 * 400); an edit sends only what changed.
 */
import { buildCreateBody, buildUpdateBody, emptyForm, formFromDevice, formProblems, todayDay, type DeviceForm } from "../register";
import { CD_IDS, device } from "@/tests/support/calibrationDatesFixtures";

const TODAY = "2026-10-09";
const UNBOUND = { bound: false, facilityRequired: true };
const BOUND = { bound: true, facilityRequired: false };
const form = (over: Partial<DeviceForm> = {}): DeviceForm => ({ ...emptyForm(), name: "Synthetic pump", ...over });
const FORBIDDEN_FOR_BOUND = ["qrCode", "status", "calibrationVendorId", "clientFacilityId"];

describe("P22-02 — device form", () => {
  it("todayDay is the browser's calendar day", () => {
    expect(todayDay(new Date(2026, 1, 3))).toBe("2026-02-03");
    expect(todayDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formFromDevice reads every field; a store, a missing location and empty values", () => {
    const f = formFromDevice(
      device({ condition: "not_good", accessoriesComplete: true, inventoriedOn: "2026-02-01", ipmIntervalMonths: 6, installationDate: "2025-01-02T00:00:00.000Z" }),
    );
    expect(f).toMatchObject({
      name: "Synthetic infusion pump",
      qrCode: "QR-000123",
      deviceTypeName: "Infusion pump",
      clientFacilityId: CD_IDS.facility,
      condition: "not_good",
      accessories: "yes",
      inventoriedOn: "2026-02-01",
      locationMode: "room",
      roomName: "Room 101",
      roomFloor: "1",
      calibrationVendorId: CD_IDS.vendor,
      installationDate: "2025-01-02",
      calibrationIntervalDays: "365",
      ipmIntervalMonths: "6",
    });
    const store = formFromDevice(device({ warehouse: { id: CD_IDS.location, name: "Depot", code: "D", kind: "store" }, accessoriesComplete: false }));
    expect(store).toMatchObject({ locationMode: "store", storeId: CD_IDS.location, roomName: "", accessories: "no" });
    const bare = formFromDevice(
      device({
        warehouse: null,
        status: null,
        qrCode: null,
        deviceTypeId: undefined,
        deviceType: null,
        clientFacilityId: undefined,
        clientFacility: null,
        calibrationIntervalDays: null,
        calibrationVendorId: null,
        serialNumber: null,
        manufacturer: null,
        model: null,
        remarks: null,
      }),
    );
    expect(bare).toMatchObject({ locationMode: "none", status: "active", qrCode: "", deviceTypeId: "", clientFacilityId: "", calibrationIntervalDays: "", accessories: "", ipmIntervalMonths: "" });
    expect(formFromDevice(device({ warehouse: { id: "w", name: "Room 9", code: "R" } }))).toMatchObject({ locationMode: "store", storeId: "w" });
    expect(formFromDevice(device({ warehouse: { id: "w", name: "Room 9", code: "R", kind: "room" } })).roomFloor).toBe("");
  });

  it.each([
    [{ name: "A" }, ["nameShort"]],
    [{ clientFacilityId: "" }, ["facilityMissing"]],
    [{ inventoriedOn: "2026-10-10" }, ["inventoryFuture"]],
    [{ inventoriedOn: "1989-12-31" }, ["inventoryTooOld"]],
    [{ roomName: "", roomFloor: "2" }, ["floorWithoutRoom"]],
    [{ locationMode: "store" as const, storeId: "" }, ["storeMissing"]],
    [{ calibrationIntervalDays: "0" }, ["intervalInvalid"]],
    [{ calibrationIntervalDays: "1.5" }, ["intervalInvalid"]],
    [{ ipmIntervalMonths: "61" }, ["ipmIntervalInvalid"]],
    [{ ipmIntervalMonths: "x" }, ["ipmIntervalInvalid"]],
    [{ calibrationIntervalDays: "365", ipmIntervalMonths: "0", inventoriedOn: "2026-10-09" }, []],
  ])("formProblems(%j) for an unbound create = %j", (patch, expected) => {
    expect(formProblems(form({ clientFacilityId: CD_IDS.facility, ...patch }), UNBOUND, true, TODAY)).toEqual(expected);
  });

  it("a bound writer and an edit need no facility; a bound writer has no store", () => {
    expect(formProblems(form(), BOUND, true, TODAY)).toEqual([]);
    expect(formProblems(form(), UNBOUND, false, TODAY)).toEqual([]);
    expect(formProblems(form(), { bound: false, facilityRequired: false }, true, TODAY)).toEqual([]);
    expect(formProblems(form({ locationMode: "store" }), BOUND, true, TODAY)).toEqual([]);
    expect(formProblems(form(), UNBOUND, true)).toEqual(["facilityMissing"]);
  });

  it("the unbound create body: every set field, the room by name, blanks left out", () => {
    const body = buildCreateBody(
      form({
        qrCode: " 42 ",
        deviceTypeId: "type-1",
        manufacturer: "Synthetic Co",
        serialNumber: "SN-1",
        condition: "good",
        accessories: "no",
        inventoriedOn: "2026-01-01",
        roomName: " Room 1 ",
        roomFloor: "",
        calibrationVendorId: CD_IDS.vendor,
        clientFacilityId: CD_IDS.facility,
        calibrationIntervalDays: "365",
        ipmIntervalMonths: "0",
        status: "maintenance",
      }),
      UNBOUND,
    );
    expect(body).toEqual({
      name: "Synthetic pump",
      qrCode: "42",
      deviceTypeId: "type-1",
      manufacturer: "Synthetic Co",
      serialNumber: "SN-1",
      condition: "good",
      accessoriesComplete: false,
      inventoriedOn: "2026-01-01",
      room: { name: "Room 1", floor: null },
      calibrationVendorId: CD_IDS.vendor,
      clientFacilityId: CD_IDS.facility,
      calibrationIntervalDays: 365,
      ipmIntervalMonths: 0,
      status: "maintenance",
    });
    expect(buildCreateBody(form({ locationMode: "store", storeId: "store-1" }), UNBOUND)).toMatchObject({ locationId: "store-1" });
    expect(buildCreateBody(form({ locationMode: "none" }), UNBOUND)).not.toHaveProperty("locationId");
  });

  it("the bound create body never carries a QR, status, laboratory, facility or store", () => {
    const body = buildCreateBody(
      form({ qrCode: "42", status: "retired", calibrationVendorId: CD_IDS.vendor, clientFacilityId: CD_IDS.facility, locationMode: "store", storeId: "s", accessories: "yes" }),
      BOUND,
    );
    for (const key of FORBIDDEN_FOR_BOUND) expect(body).not.toHaveProperty(key);
    expect(body).toEqual({ name: "Synthetic pump", accessoriesComplete: true });
  });

  it("an edit sends only what changed; a cleared field is null; the room only when it changed", () => {
    const before = formFromDevice(device());
    expect(buildUpdateBody(before, before, UNBOUND)).toEqual({});
    const after: DeviceForm = {
      ...before,
      name: "Renamed pump",
      serialNumber: "",
      manufacturer: "M",
      model: "X",
      category: "C",
      deviceTypeId: "",
      condition: "broken",
      accessories: "yes",
      inventoriedOn: "2026-01-01",
      installationDate: "2025-01-01",
      nextCalibrationDate: "",
      calibrationIntervalDays: "",
      ipmIntervalMonths: "3",
      remarks: "note",
      roomFloor: "2",
      qrCode: "",
      status: "inactive",
      calibrationVendorId: "",
    };
    expect(buildUpdateBody(after, before, UNBOUND)).toEqual({
      name: "Renamed pump",
      serialNumber: null,
      manufacturer: "M",
      model: "X",
      category: "C",
      deviceTypeId: null,
      condition: "broken",
      accessoriesComplete: true,
      inventoriedOn: "2026-01-01",
      installationDate: "2025-01-01",
      nextCalibrationDate: null,
      calibrationIntervalDays: null,
      ipmIntervalMonths: 3,
      remarks: "note",
      room: { name: "Room 101", floor: "2" },
      qrCode: null,
      status: "inactive",
      calibrationVendorId: null,
    });
    const bound = buildUpdateBody(after, before, BOUND);
    for (const key of FORBIDDEN_FOR_BOUND) expect(bound).not.toHaveProperty(key);
    expect(buildUpdateBody({ ...before, locationMode: "none" }, before, UNBOUND)).toEqual({ locationId: null });
    expect(buildUpdateBody({ ...before, roomName: "" }, before, UNBOUND)).toEqual({ locationId: null });
    const good = formFromDevice(device({ condition: "good" }));
    expect(buildUpdateBody({ ...good, condition: "" }, good, UNBOUND)).toEqual({ condition: null });
    expect(buildUpdateBody({ ...before, locationMode: "store", storeId: "s" }, before, BOUND)).toEqual({ locationId: null });
  });
});
