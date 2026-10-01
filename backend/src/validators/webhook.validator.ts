/**
 * webhook request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/webhook` (packages/contracts/src/webhook.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  ROTATION_OVERLAP_DEFAULT_HOURS,
  ROTATION_OVERLAP_MAX_HOURS,
  createWebhookSchema,
  updateWebhookSchema,
  rotateWebhookSecretSchema,
} from "@callibrator/contracts/webhook";
