/**
 * QMS (Non-Conformance / CAPA) value sets.
 *
 * P9-22 (ADR-097): canonical here since the qms request schemas became a
 * contract. backend/src/constants/qmsConstants.ts re-exports these same frozen
 * arrays (identity asserted in test/constants.test.ts), so the models' ENUM
 * columns and the validators still read one definition (A-74).
 *
 * The validators used to restate these lists by hand. A list that drifts from
 * the column's ENUM lets an out-of-set value reach PostgreSQL, which answers
 * with an enum error the API reports as a 500 instead of a 400. The database
 * ENUMs were created by migration 0006 with exactly these values; changing a
 * list here without a migration that alters the type is a defect.
 */

export const NC_STATUSES = Object.freeze(["OPEN", "UNDER_INVESTIGATION", "CAPA_REQUIRED", "CLOSED"] as const);
export const NC_SEVERITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const);
export const CAPA_STATUSES = Object.freeze(["DRAFT", "OPEN", "IN_PROGRESS", "VERIFICATION", "CLOSED"] as const);

export type NcStatus = (typeof NC_STATUSES)[number];
export type NcSeverity = (typeof NC_SEVERITIES)[number];
export type CapaStatus = (typeof CAPA_STATUSES)[number];
