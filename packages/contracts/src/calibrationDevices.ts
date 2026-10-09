/**
 * Calibration device request schemas — the contract for
 * /api/v1/calibration-devices (list query, id param, create and update bodies).
 *
 * P9-11 (ADR-093): moved to Zod. Query values arrive as strings, so page / limit
 * convert from numeric text (`numeric`), as they did before P9-11.
 * P9-22 (ADR-097): moved here from
 * backend/src/validators/calibrationDevices.validator.ts, which re-exports
 * these same objects; the frontend derives its request types from them.
 */
import { z } from "zod";
import { booleanish, caseless, dateLike, numeric, optionalText, uuid } from "./fields";
import { CALIBRATION_DUE_FILTERS, DEVICE_CONDITIONS, INVENTORIED_ON_MIN, IPM_INTERVAL_MONTHS_MAX } from "./deviceValues";

const DEVICE_STATUSES = ["active", "inactive", "maintenance", "retired"] as const;

// ==========================================
// QUERY / PARAMS
// ==========================================

/** The device list's views (P19-08 § 7.2): the full row, or the PWA's narrow `fieldDeviceSummary`. */
const DEVICE_LIST_VIEWS = ["full", "field"] as const;
/** The device list's sorts; each ends in `id`. */
const DEVICE_LIST_SORTS = ["name", "id"] as const;

/** A calendar day, `YYYY-MM-DD` (a real date), kept as text. */
const dayText = (): z.ZodString =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use the form YYYY-MM-DD" })
    .refine((text) => { const at = new Date(`${text}T00:00:00Z`); return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(text); }, { error: "Not a calendar date" });

const getCalibrationDevicesQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  // P21-02a (P19-03 § 8.3): up to 200 a page; the field working set pages by 200 (P19-08 § 7.2).
  limit: numeric(z.number().int().min(1).max(200)).default(20),
  find: z.string().nullable().optional(),
  status: caseless(DEVICE_STATUSES, "lower").or(z.literal("")).nullable().optional(),
  category: z.string().nullable().optional(),
  // P21-02a (P19-03 § 8.3): the register's filters. `qrCode` is normalised with the tenant's settings.
  qrCode: z.string().trim().min(1).max(64).optional(),
  deviceTypeId: uuid().optional(),
  condition: z.enum(DEVICE_CONDITIONS).optional(),
  locationId: uuid().optional(),
  clientFacilityId: uuid().optional(),
  // P21-05 (P19-05 § 6): the devices whose calibration is overdue, due soon, or requested by an IPM.
  calibrationDue: z.enum(CALIBRATION_DUE_FILTERS).optional(),
  view: z.enum(DEVICE_LIST_VIEWS).optional(),
  sort: z.enum(DEVICE_LIST_SORTS).optional(),
});

/** `GET /calibration-devices/by-qr/:qrCode` (P19-03 § 8.2): the raw sticker; normalised by the service. */
const deviceQrParams = z.object({
  qrCode: z.string().min(1).max(64),
});

const calibrationDeviceIdSchema = z.object({
  calibrationDeviceId: uuid(),
});

// ==========================================
// CRUD
// ==========================================

/** A room found or created by name (and floor) in the device's facility (P19-03 § 6.3). */
const roomInput = z.strictObject({
  name: z.string().trim().min(1).max(255),
  floor: z.string().trim().max(50).nullable().optional(),
});

/** P21-02a (P19-03 § 4.1): the register's new fields, the same on create and update. */
const registerFields = {
  // The sticker as scanned or typed; normalised by the service with the tenant's settings. null clears it.
  qrCode: z.string().max(64).nullable().optional(),
  inventoriedOn: dayText()
    .refine((text) => text >= INVENTORIED_ON_MIN, { error: `An inventory date is on or after ${INVENTORIED_ON_MIN}` })
    .nullable()
    .optional(),
  accessoriesComplete: booleanish().nullable().optional(),
  condition: z.enum(DEVICE_CONDITIONS).nullable().optional(),
  calibrationVendorId: uuid().nullable().optional(),
  ipmIntervalMonths: numeric(z.number().int().min(0).max(IPM_INTERVAL_MONTHS_MAX)).nullable().optional(),
  room: roomInput.optional(),
};

/** `locationId` or `room`, never both (P19-03 § 6.3). */
const oneLocation = (body: { locationId?: unknown; room?: unknown }): boolean =>
  body.room === undefined || body.locationId === undefined || body.locationId === null || body.locationId === "";
const ONE_LOCATION = { error: "Give a locationId or a room, not both", path: ["room"] };

const createFields = {
  name: z.string().trim().min(2).max(255),
  serialNumber: optionalText(100),
  manufacturer: optionalText(255),
  model: optionalText(255),
  category: optionalText(100),
  status: caseless(DEVICE_STATUSES, "lower").default("active"),
  locationId: uuid().or(z.literal("")).nullable().optional(),
  installationDate: dateLike().or(z.literal("")).nullable().optional(),
  nextCalibrationDate: dateLike().or(z.literal("")).nullable().optional(),
  calibrationIntervalDays: numeric(z.number().int().min(1)).or(z.literal("")).nullable().optional(),
  remarks: optionalText(),
  // P21-09 (G-F1; ADR-124 Am. 2 § 1): the client facility the device belongs to. Optional: an
  // unbound creator naming none gets the tenant's own (self) facility; a bound one gets its own.
  // Create only: a device changes facility through the audited move, never an edit (AM-6).
  clientFacilityId: uuid().optional(),
  // P21-01 (ADR-125; spec P19-01 § 4.7): the device's type in the global catalogue. A retired type
  // cannot be GIVEN (400); a device that already holds one keeps it. null clears it.
  deviceTypeId: uuid().nullable().optional(),
  ...registerFields,
  // P21-02a (ADR-127 § 7): the offline registration's reference; a replay by the same creator answers its device.
  clientRef: z.guid().optional(),
};

const updateFields = {
  name: z.string().trim().min(2).max(255).optional(),
  serialNumber: optionalText(100),
  manufacturer: optionalText(255),
  model: optionalText(255),
  category: optionalText(100),
  status: caseless(DEVICE_STATUSES, "lower").nullable().optional(),
  locationId: uuid().or(z.literal("")).nullable().optional(),
  installationDate: dateLike().or(z.literal("")).nullable().optional(),
  nextCalibrationDate: dateLike().or(z.literal("")).nullable().optional(),
  calibrationIntervalDays: numeric(z.number().int().min(1)).or(z.literal("")).nullable().optional(),
  remarks: optionalText(),
  // P21-01: as on create; a retired type is refused only when the edit CHANGES the type.
  deviceTypeId: uuid().nullable().optional(),
  ...registerFields,
  // P21-02a (ADR-132 § 7): accepted only to refuse a change (400 "Move the device instead."); naming
  // the device's own facility is no change.
  clientFacilityId: uuid().optional(),
};

/** The fields a facility-BOUND writer never sends (ADR-132 § 1, § 5; OQ-2): strict, so each is a 400. */
const BOUND_ABSENT = { qrCode: true, status: true, calibrationVendorId: true } as const;

const createCalibrationDeviceSchema = z.object(createFields).refine(oneLocation, ONE_LOCATION);
const updateCalibrationDeviceSchema = z.object(updateFields).refine(oneLocation, ONE_LOCATION);
/** P21-02a (P19-03 § 5): a facility-bound technician's create: no QR, status or vendor; unknown keys refused. */
const createCalibrationDeviceBoundSchema = z.strictObject(createFields).omit(BOUND_ABSENT).refine(oneLocation, ONE_LOCATION);
/** P21-02a (P19-03 § 5): a facility-bound technician's edit: no QR, status or vendor; unknown keys refused. */
const updateCalibrationDeviceBoundSchema = z.strictObject(updateFields).omit(BOUND_ABSENT).refine(oneLocation, ONE_LOCATION);

export {
  DEVICE_STATUSES,
  DEVICE_LIST_VIEWS,
  DEVICE_LIST_SORTS,
  dayText,
  roomInput,
  getCalibrationDevicesQuery,
  calibrationDeviceIdSchema,
  deviceQrParams,
  createCalibrationDeviceSchema,
  updateCalibrationDeviceSchema,
  createCalibrationDeviceBoundSchema,
  updateCalibrationDeviceBoundSchema,
};

/** A calibration device's status, as the API stores it. */
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** The list query a client may send. */
export type GetCalibrationDevicesQueryInput = z.input<typeof getCalibrationDevicesQuery>;
/** What a client may send to create a calibration device (the schema's input). */
export type CreateCalibrationDeviceInput = z.input<typeof createCalibrationDeviceSchema>;
/** What a client may send to update a calibration device. */
export type UpdateCalibrationDeviceInput = z.input<typeof updateCalibrationDeviceSchema>;

/** The validated create body (the schema's output). */
export type CreateCalibrationDeviceBody = z.output<typeof createCalibrationDeviceSchema>;
/** The validated update body. */
export type UpdateCalibrationDeviceBody = z.output<typeof updateCalibrationDeviceSchema>;
/** The validated list query. */
export type GetCalibrationDevicesQueryBody = z.output<typeof getCalibrationDevicesQuery>;
/** A room named on the device form. */
export type RoomInput = z.output<typeof roomInput>;
