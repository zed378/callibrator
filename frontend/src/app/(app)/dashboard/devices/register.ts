/**
 * P22-02 — the device form as plain data (P19-03 spec § 4 – § 6, § 8.1, as built by P21-02a): the
 * form's state, the checks it runs before a round trip (the server still decides), and the exact
 * request bodies.
 *
 * Who may send what (spec § 5): a facility-BOUND technician's contract is strict and has no QR,
 * status or calibration laboratory — the body builders never put those keys in one (each would be a
 * 400). A provider user names the facility on create; nobody changes it by an edit (the move does).
 * An edit sends only what changed, so an untouched field is never rewritten (a condition re-sent
 * would restamp its source).
 */
import type { DeviceCreateBody, DeviceUpdateBody, RegisterDevice } from "@/api/services/deviceRegister.service";

export type Condition = "" | "good" | "not_good" | "broken";

/** P22-07 (F-71): a `?condition=` value the list can filter by, else none (`unset` has no filter). */
export const conditionOf = (value: string | string[] | undefined): Condition =>
  value === "good" || value === "not_good" || value === "broken" ? value : "";
export type Accessories = "" | "yes" | "no";
export type Status = "active" | "inactive" | "maintenance" | "retired";
/** Where the device stands: a room of its facility (found or created by name), a store, or nowhere. */
export type LocationMode = "room" | "store" | "none";

export interface DeviceForm {
  name: string;
  qrCode: string;
  deviceTypeId: string;
  deviceTypeName: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  category: string;
  clientFacilityId: string;
  status: Status;
  condition: Condition;
  accessories: Accessories;
  inventoriedOn: string;
  locationMode: LocationMode;
  roomName: string;
  roomFloor: string;
  storeId: string;
  calibrationVendorId: string;
  installationDate: string;
  nextCalibrationDate: string;
  calibrationIntervalDays: string;
  ipmIntervalMonths: string;
  remarks: string;
}

/** Who fills the form in: what the page knows of the caller. */
export interface Writer {
  /** A facility-bound account (no QR, status, laboratory, store or facility choice). */
  bound: boolean;
  /** The facility must be named on create (the tenant serves other facilities than itself). */
  facilityRequired: boolean;
}

/** The problems the form can find; each is a message key under `devices.problem.`. */
export type FormProblem =
  | "nameShort"
  | "facilityMissing"
  | "inventoryFuture"
  | "inventoryTooOld"
  | "floorWithoutRoom"
  | "roomMissing"
  | "storeMissing"
  | "intervalInvalid"
  | "ipmIntervalInvalid";

export const INVENTORY_EARLIEST = "1990-01-01";
export const IPM_INTERVAL_MAX = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE = /^\d+$/;

const day = (value: string | null | undefined): string => (value ? value.substring(0, 10) : "");

/** Today in the browser's zone, as `YYYY-MM-DD`. */
export const todayDay = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** A new device's form: active, its location a room, the facility preset only when there is one choice. */
export const emptyForm = (facilityId = ""): DeviceForm => ({
  name: "",
  qrCode: "",
  deviceTypeId: "",
  deviceTypeName: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  category: "",
  clientFacilityId: facilityId,
  status: "active",
  condition: "",
  accessories: "",
  inventoriedOn: "",
  locationMode: "room",
  roomName: "",
  roomFloor: "",
  storeId: "",
  calibrationVendorId: "",
  installationDate: "",
  nextCalibrationDate: "",
  calibrationIntervalDays: "",
  ipmIntervalMonths: "",
  remarks: "",
});

/** The form for an existing device, as it reads. */
export const formFromDevice = (d: RegisterDevice): DeviceForm => {
  const w = d.warehouse;
  const mode: LocationMode = !w ? "none" : w.kind === "room" ? "room" : "store";
  const status: Status = d.status ?? "active";
  return {
    name: d.name,
    qrCode: d.qrCode ?? "",
    deviceTypeId: d.deviceTypeId ?? d.deviceType?.id ?? "",
    deviceTypeName: d.deviceType?.name ?? "",
    manufacturer: d.manufacturer ?? "",
    model: d.model ?? "",
    serialNumber: d.serialNumber ?? "",
    category: d.category ?? "",
    clientFacilityId: d.clientFacilityId ?? d.clientFacility?.id ?? "",
    status,
    condition: d.condition ?? "",
    accessories: d.accessoriesComplete === true ? "yes" : d.accessoriesComplete === false ? "no" : "",
    inventoriedOn: day(d.inventoriedOn),
    locationMode: mode,
    roomName: mode === "room" && w ? w.name : "",
    roomFloor: mode === "room" && w ? (w.floor ?? "") : "",
    storeId: mode === "store" && w ? w.id : "",
    calibrationVendorId: d.calibrationVendorId ?? "",
    installationDate: day(d.installationDate),
    nextCalibrationDate: day(d.nextCalibrationDate),
    calibrationIntervalDays: d.calibrationIntervalDays === null ? "" : String(d.calibrationIntervalDays),
    ipmIntervalMonths: d.ipmIntervalMonths === null || d.ipmIntervalMonths === undefined ? "" : String(d.ipmIntervalMonths),
    remarks: d.remarks ?? "",
  };
};

/** What would stop the save, in the order the form shows it. */
export const formProblems = (f: DeviceForm, writer: Writer, creating: boolean, today: string = todayDay()): FormProblem[] => {
  const problems: FormProblem[] = [];
  if (f.name.trim().length < 2) problems.push("nameShort");
  if (creating && !writer.bound && writer.facilityRequired && !f.clientFacilityId) problems.push("facilityMissing");
  if (DAY.test(f.inventoriedOn)) {
    if (f.inventoriedOn > today) problems.push("inventoryFuture");
    else if (f.inventoriedOn < INVENTORY_EARLIEST) problems.push("inventoryTooOld");
  }
  if (f.locationMode === "room") {
    if (f.roomFloor.trim() && !f.roomName.trim()) problems.push("floorWithoutRoom");
  }
  if (f.locationMode === "store" && !writer.bound && !f.storeId) problems.push("storeMissing");
  const interval = f.calibrationIntervalDays.trim();
  if (interval && (!WHOLE.test(interval) || Number(interval) < 1)) problems.push("intervalInvalid");
  const ipm = f.ipmIntervalMonths.trim();
  if (ipm && (!WHOLE.test(ipm) || Number(ipm) > IPM_INTERVAL_MAX)) problems.push("ipmIntervalInvalid");
  return problems;
};

const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const numberOrNull = (value: string): number | null => (value.trim() === "" ? null : Number(value.trim()));
const accessories = (value: Accessories): boolean | null => (value === "yes" ? true : value === "no" ? false : null);

/** The location the form names: a room by name (the server finds or creates it), a store, or none. */
const location = (f: DeviceForm, bound: boolean): { room?: { name: string; floor: string | null }; locationId?: string | null } => {
  if (f.locationMode === "room") {
    const name = text(f.roomName);
    return name ? { room: { name, floor: text(f.roomFloor) } } : { locationId: null };
  }
  if (f.locationMode === "store" && !bound && f.storeId) return { locationId: f.storeId };
  return { locationId: null };
};

/** The create body: blank optionals left out; a bound writer's body has no QR, status or laboratory. */
export const buildCreateBody = (f: DeviceForm, writer: Writer): DeviceCreateBody => {
  const body: DeviceCreateBody = { name: f.name.trim() };
  const put = <K extends keyof DeviceCreateBody>(key: K, value: DeviceCreateBody[K] | null): void => {
    if (value !== null && value !== undefined) body[key] = value as DeviceCreateBody[K];
  };
  put("serialNumber", text(f.serialNumber));
  put("manufacturer", text(f.manufacturer));
  put("model", text(f.model));
  put("category", text(f.category));
  put("deviceTypeId", f.deviceTypeId || null);
  put("condition", f.condition || null);
  put("accessoriesComplete", accessories(f.accessories));
  put("inventoriedOn", f.inventoriedOn || null);
  put("installationDate", f.installationDate || null);
  put("nextCalibrationDate", f.nextCalibrationDate || null);
  put("calibrationIntervalDays", numberOrNull(f.calibrationIntervalDays));
  put("ipmIntervalMonths", numberOrNull(f.ipmIntervalMonths));
  put("remarks", text(f.remarks));
  const where = location(f, writer.bound);
  if (where.room) body.room = where.room;
  else if (where.locationId) body.locationId = where.locationId;
  if (!writer.bound) {
    put("qrCode", text(f.qrCode));
    body.status = f.status;
    put("calibrationVendorId", f.calibrationVendorId || null);
    put("clientFacilityId", f.clientFacilityId || null);
  }
  return body;
};

/**
 * The update body: only the fields that changed from `before` (the form as the device read), a
 * cleared field sent as null. The facility is never sent (the move changes it).
 */
export const buildUpdateBody = (f: DeviceForm, before: DeviceForm, writer: Writer): DeviceUpdateBody => {
  const body: DeviceUpdateBody = {};
  const changed = (key: keyof DeviceForm): boolean => f[key].trim() !== before[key].trim();
  if (changed("name")) body.name = f.name.trim();
  if (changed("serialNumber")) body.serialNumber = text(f.serialNumber);
  if (changed("manufacturer")) body.manufacturer = text(f.manufacturer);
  if (changed("model")) body.model = text(f.model);
  if (changed("category")) body.category = text(f.category);
  if (changed("deviceTypeId")) body.deviceTypeId = f.deviceTypeId || null;
  if (changed("condition")) body.condition = f.condition || null;
  if (changed("accessories")) body.accessoriesComplete = accessories(f.accessories);
  if (changed("inventoriedOn")) body.inventoriedOn = f.inventoriedOn || null;
  if (changed("installationDate")) body.installationDate = f.installationDate || null;
  if (changed("nextCalibrationDate")) body.nextCalibrationDate = f.nextCalibrationDate || null;
  if (changed("calibrationIntervalDays")) body.calibrationIntervalDays = numberOrNull(f.calibrationIntervalDays);
  if (changed("ipmIntervalMonths")) body.ipmIntervalMonths = numberOrNull(f.ipmIntervalMonths);
  if (changed("remarks")) body.remarks = text(f.remarks);
  if (changed("locationMode") || changed("roomName") || changed("roomFloor") || changed("storeId")) {
    const where = location(f, writer.bound);
    if (where.room) body.room = where.room;
    else body.locationId = where.locationId ?? null;
  }
  if (!writer.bound) {
    if (changed("qrCode")) body.qrCode = text(f.qrCode);
    if (changed("status")) body.status = f.status;
    if (changed("calibrationVendorId")) body.calibrationVendorId = f.calibrationVendorId || null;
  }
  return body;
};
