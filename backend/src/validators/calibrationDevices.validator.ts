/**
 * Calibration Device validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/calibrationDevices`
 * (packages/contracts/src/calibrationDevices.ts), shared with the frontend.
 * The same objects are re-exported here under the same names, so the
 * controller, the service and the tests are unchanged.
 */
export {
  getCalibrationDevicesQuery,
  calibrationDeviceIdSchema,
  createCalibrationDeviceSchema,
  updateCalibrationDeviceSchema,
} from "@callibrator/contracts/calibrationDevices";
