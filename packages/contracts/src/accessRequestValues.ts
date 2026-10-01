/**
 * P10-05 (ADR-098 §6) — the vocabulary of an access request: the values of its
 * PostgreSQL ENUMs, in declaration order (migration 0099).
 *
 * P9-22 (ADR-097 Am. 2): canonical here, because the access-request schemas
 * are a contract. backend/src/constants/accessRequest.ts re-exports these same
 * arrays (identity asserted in test/constants.test.ts), so the model, the
 * migration, the service and the validator still read one definition.
 */

/** `facility_type`. */
export const FACILITY_TYPES = ["hospital", "clinic", "calibration_lab", "other"] as const;
/** `device_count_band`: a band, never a number (nobody knows it exactly). */
export const DEVICE_COUNT_BANDS = ["lt_100", "100_499", "500_1999", "gte_2000", "unknown"] as const;
/** `locale`: the language the form was filled in; replies use it. */
export const REQUEST_LOCALES = ["id", "en"] as const;
/** `status`. `expired` is set by the retention sweep only, never by a request. */
export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "rejected", "spam", "expired"] as const;

export type FacilityType = (typeof FACILITY_TYPES)[number];
export type DeviceCountBand = (typeof DEVICE_COUNT_BANDS)[number];
export type RequestLocale = (typeof REQUEST_LOCALES)[number];
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
