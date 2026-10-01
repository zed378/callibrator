/**
 * notification request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/notification` (packages/contracts/src/notification.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  deleteManySchema,
} from "@callibrator/contracts/notification";
