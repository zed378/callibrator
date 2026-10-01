/**
 * P10-05 (ADR-098 §6) — the vocabulary of an access request, shared by the
 * model (`models/accessRequest.model.ts`), migration 0097, the validator and
 * the service. Each list is in its PostgreSQL ENUM's declaration order.
 */

// P9-22 (ADR-097 Am. 2): the ENUM vocabularies are canonical in
// `@callibrator/contracts/accessRequestValues` (the access-request schemas are a
// contract); the same arrays are re-exported here. The retention and cap
// numbers below stay backend-only.
export {
  ACCESS_REQUEST_STATUSES,
  DEVICE_COUNT_BANDS,
  FACILITY_TYPES,
  REQUEST_LOCALES,
} from "@callibrator/contracts/accessRequestValues";
export type {
  AccessRequestStatus,
  DeviceCountBand,
  FacilityType,
  RequestLocale,
} from "@callibrator/contracts/accessRequestValues";

/** A pending request nobody decides becomes `expired` after this many days (Q-42). */
export const PENDING_EXPIRY_DAYS = 90;
/** Rejected, spam and expired rows are deleted this many months after their decision (Q-42). */
export const DECIDED_RETENTION_MONTHS = 12;
/** The invitation link's lifetime (Q-45): seven days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Requests stored per work email per 24 hours; beyond it nothing is stored, the answer is the same. */
export const PER_EMAIL_DAILY_CAP = 3;
