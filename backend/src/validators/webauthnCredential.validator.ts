/**
 * webauthnCredential request schemas.
 *
 * P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/webauthnCredential` (packages/contracts/src/webauthnCredential.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  passkeyIdSchema,
  renamePasskeySchema,
  revokePasskeySchema,
} from "@callibrator/contracts/webauthnCredential";
