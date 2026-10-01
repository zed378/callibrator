/**
 * accessRequest request schemas.
 *
 * P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/accessRequest` (packages/contracts/src/accessRequest.ts), shared with the
 * frontend. The same objects are re-exported here under the same names, so
 * every importer and test is unchanged.
 */
export {
  normaliseWhatsapp,
  submitAccessRequestSchema,
  listAccessRequestsSchema,
  accessRequestIdSchema,
  approveAccessRequestSchema,
  rejectAccessRequestSchema,
  eraseAccessRequestsSchema,
} from "@callibrator/contracts/accessRequest";
export type {
  SubmitAccessRequestInput,
  ListAccessRequestsInput,
  ApproveAccessRequestInput,
  RejectAccessRequestInput,
} from "@callibrator/contracts/accessRequest";
