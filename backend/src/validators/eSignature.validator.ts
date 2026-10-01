/**
 * eSignature request schemas.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/eSignature` (packages/contracts/src/eSignature.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  createKeyPair,
  createWorkflow,
  signDocument,
  verifySignature,
  cancelWorkflow,
} from "@callibrator/contracts/eSignature";
