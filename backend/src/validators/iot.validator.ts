/**
 * iot request schemas.
 *
 * P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/iot` (packages/contracts/src/iot.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  readingToleranceSchema,
  deviceIdSchema,
  updateIotConfigSchema,
} from "@callibrator/contracts/iot";
export type {
  MetricBoundsInput,
  ReadingToleranceInput,
} from "@callibrator/contracts/iot";
