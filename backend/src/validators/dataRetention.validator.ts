/**
 * dataRetention request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/dataRetention` (packages/contracts/src/dataRetention.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  tenantIdSchema,
  retentionPolicySchema,
  legalHoldSchema,
  piiMaskSchema,
  anonymizeSchema,
} from "@callibrator/contracts/dataRetention";
