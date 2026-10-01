/**
 * QMS (Non-Conformance / CAPA) value sets — the ONE definition the models'
 * ENUM columns and the request validators both read (A-74).
 *
 * P9-22 (ADR-097): NC_STATUSES, NC_SEVERITIES and CAPA_STATUSES (and their
 * types) are canonical in `@callibrator/contracts/qmsValues`, because the qms
 * request schemas are a contract the frontend reads. This module re-exports
 * the same frozen arrays, so every model, service and test is unchanged.
 * The ENUMs were created by migration 0006 with exactly these values; changing
 * a list there without a migration that alters the type is a defect.
 */
export { NC_STATUSES, NC_SEVERITIES, CAPA_STATUSES } from "@callibrator/contracts/qmsValues";
export type { NcStatus, NcSeverity, CapaStatus } from "@callibrator/contracts/qmsValues";

/**
 * Per-tenant record numbering (A-73). `kind` is the qms_counters row key;
 * `table`/`column` are where the issued numbers live (used to seed a counter
 * from the numbers already issued); `prefix` is the human-facing prefix.
 * Identifiers here are code constants, never request input — they are
 * interpolated into SQL.
 */
export const QMS_NUMBERING = Object.freeze({
  NC: Object.freeze({ kind: "NC", table: "non_conformances", column: "nc_number", prefix: "NC-" } as const),
  CAPA: Object.freeze({ kind: "CAPA", table: "capas", column: "capa_number", prefix: "CAPA-" } as const),
});
