/**
 * featureFlag request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/featureFlag` (packages/contracts/src/featureFlag.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  flagKeySchema,
  flagValueSchema,
  tenantFlagQuerySchema,
} from "@callibrator/contracts/featureFlag";
