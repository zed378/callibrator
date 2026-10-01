/**
 * calibrationRecords request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/calibrationRecords` (packages/contracts/src/calibrationRecords.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  getCalibrationRecordsQuery,
  calibrationRecordIdSchema,
  calibrationDeviceIdSchema,
  createCalibrationRecordSchema,
  correctCalibrationRecordSchema,
  voidCalibrationRecordSchema,
} from "@callibrator/contracts/calibrationRecords";
