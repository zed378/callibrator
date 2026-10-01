/**
 * POST /calibration-devices/:id/reinstate — calibrationDeviceReinstate.service.
 *
 * P9-11 (ADR-093): moved to Zod. The schema lived in the service; it moved here
 * with the conversion, in a module of its own: the statuses a device may
 * return to are deliberately a SUBSET of the device status ENUM (never
 * "retired"), while calibrationDevices.validator mirrors the whole ENUM
 * (the D-26 guard holds that module to `equal`).
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/calibrationDeviceReinstate.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the calibrationDeviceReinstate routes.
 */
import { z } from "zod";

/** The statuses a reinstated device may return to. */
const REINSTATE_STATUSES = Object.freeze(["active", "inactive", "maintenance"] as const);

/** A reinstatement names why (at least 10 characters) and the status to return to. */
const reinstateCalibrationDeviceSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  status: z.string().toLowerCase().pipe(z.enum(REINSTATE_STATUSES)),
});

export { REINSTATE_STATUSES, reinstateCalibrationDeviceSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type ReinstateCalibrationDeviceInput = z.input<typeof reinstateCalibrationDeviceSchema>;
export type ReinstateCalibrationDeviceBody = z.output<typeof reinstateCalibrationDeviceSchema>;
