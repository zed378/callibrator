/**
 * tenant request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/tenant` (packages/contracts/src/tenant.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  getAllTenantsQuery,
  getTenantSchema,
  createTenantSchema,
  updateTenantSchema,
  deleteTenantSchema,
  tenantIdSchema,
} from "@callibrator/contracts/tenant";
