/**
 * Calibration Record validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/calibrationRecords.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for /api/v1/calibration-records (list query, id params, create and update bodies).
 */
import { z } from "zod";
import { booleanish, dateLike, jsonObject, numeric, optionalText, uuid } from "./fields";
import { dayText, roomInput } from "./calibrationDevices";

// ==========================================
// QUERY / PARAMS
// ==========================================

const getCalibrationRecordsQuery = z.object({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(100)).default(20),
  deviceId: uuid().or(z.literal("")).nullable().optional(),
  isCompliant: booleanish().nullable().optional(),
  from: dateLike().or(z.literal("")).nullable().optional(),
  to: dateLike().or(z.literal("")).nullable().optional(),
  // P6-03: include records a correction has superseded (the history).
  includeSuperseded: booleanish().default(false),
});

const calibrationRecordIdSchema = z.object({
  calibrationRecordId: uuid(),
});

const calibrationDeviceIdSchema = z.object({
  calibrationDeviceId: uuid(),
});

// ==========================================
// CRUD
// ==========================================

const certificateFileUrl = z.url().max(1024).or(z.literal("")).nullable().optional();

const createCalibrationRecordSchema = z.object({
  deviceId: uuid(),
  calibrationDate: dateLike().default(() => new Date()),
  dueDate: dateLike().or(z.literal("")).nullable().optional(),
  standard: optionalText(255),
  results: jsonObject().or(z.literal("")).nullable().optional(),
  isCompliant: booleanish().nullable().optional(),
  certificateNumber: optionalText(100),
  certificateFileUrl,
  notes: optionalText(),
});

// P6-03 — there is no update schema. A calibration record is append-only
// (BR-7; migration 0057's trigger refuses a content change for every role).

/**
 * Why a correction or a void happened. Required, and never blank: `trim()`
 * runs before the length check, so "   " is refused rather than stored as a
 * reason that says nothing.
 */
const lifecycleReason = z.string().trim().min(3).max(2000);

/**
 * POST /calibration-records/:id/corrections — the corrected content (any
 * subset; omitted fields are carried over from the original) and the reason.
 */
const correctCalibrationRecordSchema = z.object({
  deviceId: uuid().optional(),
  calibrationDate: dateLike().optional(),
  dueDate: dateLike().nullable().optional(),
  standard: optionalText(255),
  results: jsonObject().nullable().optional(),
  measurementUncertainty: numeric(z.number()).nullable().optional(),
  isCompliant: booleanish().nullable().optional(),
  certificateNumber: optionalText(100),
  certificateFileUrl,
  notes: optionalText(),
  reason: lifecycleReason,
});

/** POST /calibration-records/:id/void */
const voidCalibrationRecordSchema = z.object({
  reason: lifecycleReason,
});

// ==========================================
// P21-05: THE QUICK EXTERNAL-CALIBRATION ENTRY (ADR-133 § 2; spec P19-05 § 7.2)
// ==========================================

/**
 * `POST /calibration-devices/:calibrationDeviceId/calibration-dates`: an outside laboratory's
 * calibration, recorded by its date and key data, with NO file (G-C3). Strict. The laboratory is a
 * vendor of the tenant and/or its name as printed; a person must name one (the service's 400; an
 * API key may not). The dates are days of the tenant's zone.
 */
const calibrationDateEntry = z
  .strictObject({
    calibrationDeviceId: uuid(),
    calibrationDate: dayText(),
    calibrationVendorId: uuid().optional(),
    externalLabName: z.string().trim().min(1).max(255).optional(),
    certificateNumber: z.string().trim().min(1).max(100).optional(),
    dueDate: dayText().optional(),
    isCompliant: z.boolean().optional(),
    locationId: uuid().optional(),
    room: roomInput.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((body) => body.dueDate === undefined || body.dueDate > body.calibrationDate, {
    error: "The next calibration date must be after the calibration date.",
    path: ["dueDate"],
  })
  .refine((body) => body.locationId === undefined || body.room === undefined, {
    error: "Give a locationId or a room, not both",
    path: ["room"],
  });

export {
  getCalibrationRecordsQuery,
  calibrationRecordIdSchema,
  calibrationDeviceIdSchema,
  createCalibrationRecordSchema,
  correctCalibrationRecordSchema,
  voidCalibrationRecordSchema,
  calibrationDateEntry,
};

/** The quick entry's validated input. */
export type CalibrationDateEntry = z.output<typeof calibrationDateEntry>;

// The client-side (input) and handler-side (output) types of each schema.
export type GetCalibrationRecordsQueryInput = z.input<typeof getCalibrationRecordsQuery>;
export type GetCalibrationRecordsQueryBody = z.output<typeof getCalibrationRecordsQuery>;
export type CalibrationRecordIdInput = z.input<typeof calibrationRecordIdSchema>;
export type CalibrationRecordIdBody = z.output<typeof calibrationRecordIdSchema>;
export type CalibrationDeviceIdInput = z.input<typeof calibrationDeviceIdSchema>;
export type CalibrationDeviceIdBody = z.output<typeof calibrationDeviceIdSchema>;
export type CreateCalibrationRecordInput = z.input<typeof createCalibrationRecordSchema>;
export type CreateCalibrationRecordBody = z.output<typeof createCalibrationRecordSchema>;
export type CorrectCalibrationRecordInput = z.input<typeof correctCalibrationRecordSchema>;
export type CorrectCalibrationRecordBody = z.output<typeof correctCalibrationRecordSchema>;
export type VoidCalibrationRecordInput = z.input<typeof voidCalibrationRecordSchema>;
export type VoidCalibrationRecordBody = z.output<typeof voidCalibrationRecordSchema>;
