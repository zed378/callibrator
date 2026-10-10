/**
 * The SQL-dump import (P24-06; ADR-129) — its request
 * shapes and its fixed vocabularies, shared by the backend (validators, service, contract) and
 * the frontend (labels, request types).
 *
 * Every vocabulary here is a CODE the server reports as a count: a reason a row or a table was
 * not loaded, a reason a run failed. None of them ever carries a value from the dump.
 */
import { z } from "zod";
import { UPSTREAM_SQL_IMPORT_STATUSES } from "./states";
import { uuid } from "./fields";

/**
 * What the uploader declares the file to be. `real` is refused while the deployment's DPIA gate
 * (`UPSTREAM_REAL_DATA_ALLOWED`) is off — and refused again by the worker before parsing.
 */
export const UPSTREAM_SQL_IMPORT_DATA_CLASSES = Object.freeze(["synthetic", "real"] as const);
export type UpstreamSqlImportDataClass = (typeof UPSTREAM_SQL_IMPORT_DATA_CLASSES)[number];

/** How the uploaded file is encoded, as sniffed from its content (never from its name). */
export const UPSTREAM_SQL_IMPORT_COMPRESSIONS = Object.freeze(["none", "gzip"] as const);
export type UpstreamSqlImportCompression = (typeof UPSTREAM_SQL_IMPORT_COMPRESSIONS)[number];

/** Why a run failed (the run's `errorCode`). */
export const UPSTREAM_SQL_IMPORT_ERROR_CODES = Object.freeze([
  "FILE_MISSING",
  "INTEGRITY_MISMATCH",
  "INFECTED",
  "SCAN_FAILED",
  "REAL_DATA_NOT_ALLOWED",
  "TRUNCATED_INPUT",
  "DECOMPRESSED_TOO_LARGE",
  "CORRUPT_COMPRESSION",
  "STAGING_ROLE_INVALID",
  "STAGING_FAILED",
  "INTERRUPTED",
] as const);
export type UpstreamSqlImportErrorCode = (typeof UPSTREAM_SQL_IMPORT_ERROR_CODES)[number];

/** Why one row was not loaded into staging. */
export const UPSTREAM_SQL_IMPORT_ROW_REJECTIONS = Object.freeze([
  // The parser: the row is not a row of a declared, accepted table.
  "arity_mismatch",
  "unsupported_value",
  "row_too_large",
  "table_not_declared",
  "table_refused",
  "unknown_column",
  // The value conversion: a value is not what its column says.
  "value_type_mismatch",
  "value_out_of_range",
  "invalid_date",
  "invalid_utf8",
  "nul_in_text",
  // The staging table exists from an earlier dump with another type for a column.
  "schema_conflict",
] as const);
export type UpstreamSqlImportRowRejection = (typeof UPSTREAM_SQL_IMPORT_ROW_REJECTIONS)[number];

/** Why a table's rows were not loaded at all. */
export const UPSTREAM_SQL_IMPORT_TABLE_REASONS = Object.freeze([
  // The extraction policy (docs/UPSTREAM/07-DATA-MINIMISATION.md): never staged.
  "not_migrated",
  "never_copied",
  "not_in_policy",
  // The parser refused the table's definition.
  "identifier_not_allowed",
  "duplicate_column",
  "too_many_columns",
  "too_many_tables",
  "no_columns",
  "malformed_definition",
  "redefined_differently",
  // Staging refused it.
  "schema_conflict",
] as const);
export type UpstreamSqlImportTableReason = (typeof UPSTREAM_SQL_IMPORT_TABLE_REASONS)[number];

/**
 * Stage 2 — the transform from staging into the application's tables (P24-01; ADR-129 § 10,
 * Am. 1). `not_available`: no transform has been asked for. A LOADED run may then be asked to
 * transform (`transform_requested`); the worker moves it to `transforming`, then `transformed`
 * or `transform_failed`. A transformed or failed run may be asked again: the transform is
 * idempotent by `source_row_hash` (docs/UPSTREAM/05 § 8).
 */
export const UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES = Object.freeze([
  "not_available",
  "transform_requested",
  "transforming",
  "transformed",
  "transform_failed",
] as const);
export type UpstreamSqlImportTransformStatus = (typeof UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES)[number];

/** Why a transform failed (the run's `transformErrorCode`). */
export const UPSTREAM_SQL_IMPORT_TRANSFORM_ERROR_CODES = Object.freeze([
  "REAL_DATA_NOT_ALLOWED",
  "TRANSFORM_NOT_BUILT",
  "TRANSFORM_ROLE_INVALID",
  "TRANSFORM_INCOMPLETE",
  "TRANSFORM_FAILED",
  "INTERRUPTED",
] as const);
export type UpstreamSqlImportTransformErrorCode = (typeof UPSTREAM_SQL_IMPORT_TRANSFORM_ERROR_CODES)[number];

/**
 * Why a staged row was quarantined by the transform (`upstream_import.quarantine.reason`;
 * docs/UPSTREAM/05 § 3.5, P19-02 § 10, P19-03 § 8, P19-04 § 15, P19-05 § 9). Every staged row
 * ends mapped (`id_map`) or quarantined with one of these — never dropped silently (05 § 1.2).
 * A new reason needs a migration widening the table's CHECK.
 */
export const UPSTREAM_IMPORT_QUARANTINE_REASONS = Object.freeze([
  // Rows (05 § 3.5, the P19 specs, P18-01-02 § 6).
  "no_device",
  "duplicate_header",
  "value_out_of_range",
  "facility_mapping_ambiguous",
  "group_conflict",
  "qr_case_collision",
  "future_calibration_date",
  // A photo row whose file did not pass 08-FILE-POLICY's ingest (the rsync import's refusal reasons).
  "file_missing",
  "file_type_refused",
  "file_truncated",
  "file_too_large",
  "image_too_large",
  "image_undecodable",
  "heic_converter_unavailable",
  "virus_found",
  "scan_failed",
  "storage_verify_failed",
  "ingest_failed",
] as const);
export type UpstreamImportQuarantineReason = (typeof UPSTREAM_IMPORT_QUARANTINE_REASONS)[number];

/**
 * `POST /admin/upstream-sql-imports` — the multipart fields beside the `file`. Multipart fields
 * are strings; `dataClass` is the uploader's declaration.
 */
export const uploadUpstreamSqlImportSchema = z.object({
  dataClass: z.enum(UPSTREAM_SQL_IMPORT_DATA_CLASSES, { error: "Declare the file synthetic or real" }),
});
export type UploadUpstreamSqlImportInput = z.output<typeof uploadUpstreamSqlImportSchema>;

/** `GET /admin/upstream-sql-imports` — newest first. */
export const listUpstreamSqlImportsSchema = z.object({
  status: z.enum(UPSTREAM_SQL_IMPORT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUpstreamSqlImportsInput = z.output<typeof listUpstreamSqlImportsSchema>;

/** `:id` of the run routes (`POST …/:id/transform` included). */
export const upstreamSqlImportIdSchema = z.object({ id: uuid() });
export type UpstreamSqlImportIdInput = z.output<typeof upstreamSqlImportIdSchema>;
