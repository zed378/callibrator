/**
 * publicAuth request schemas.
 *
 * P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/publicAuth` (packages/contracts/src/publicAuth.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  loginDiscoverSchema,
  ssoStartSchema,
  passkeyVerifySchema,
  invitationAcceptSchema,
  ssoEmailDomainsSchema,
} from "@callibrator/contracts/publicAuth";
