/**
 * QMS (Non-Conformance / CAPA) value sets — the ONE definition the models'
 * ENUM columns and the request validators both read (A-74).
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
