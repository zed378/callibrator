/**
 * maintenance request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/maintenance` (packages/contracts/src/maintenance.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  createWorkOrder,
  updateWorkOrder,
} from "@callibrator/contracts/maintenance";
