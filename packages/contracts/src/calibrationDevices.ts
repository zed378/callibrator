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
import { caseless, dateLike, numeric, optionalText, uuid } from "./fields";

const DEVICE_STATUSES = ["active", "inactive", "maintenance", "retired"] as const;

// ==========================================
// QUERY / PARAMS
// ==========================================

const getCalibrationDevicesQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(100)).default(20),
  find: z.string().nullable().optional(),
  status: caseless(DEVICE_STATUSES, "lower").or(z.literal("")).nullable().optional(),
  category: z.string().nullable().optional(),
});

const calibrationDeviceIdSchema = z.object({
  calibrationDeviceId: uuid(),
});

// ==========================================
// CRUD
// ==========================================

const createCalibrationDeviceSchema = z.object({
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
});

const updateCalibrationDeviceSchema = z.object({
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
});

export {
  DEVICE_STATUSES,
  getCalibrationDevicesQuery,
  calibrationDeviceIdSchema,
  createCalibrationDeviceSchema,
  updateCalibrationDeviceSchema,
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
