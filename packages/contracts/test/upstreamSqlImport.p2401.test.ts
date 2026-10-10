/**
 * P24-01 — the transform's vocabularies (@callibrator/contracts/upstreamSqlImport): the
 * transform lifecycle, its failure codes and the quarantine reasons. Written from the rules
 * (docs/UPSTREAM/05 § 3.5, § 8; ADR-129 Am. 1), not read back from the module: a reason
 * deleted from the list fails here, and migration 0133's CHECK is built from the same list.
 */
import {
  UPSTREAM_IMPORT_QUARANTINE_REASONS,
  UPSTREAM_SQL_IMPORT_TRANSFORM_ERROR_CODES,
  UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES,
} from "@callibrator/contracts/upstreamSqlImport";

describe("P24-01 @callibrator/contracts/upstreamSqlImport — the transform", () => {
  it("the lifecycle: not requested, requested, running, done or failed", () => {
    expect([...UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES]).toEqual(["not_available", "transform_requested", "transforming", "transformed", "transform_failed"]);
  });

  it("the failure codes: the DPIA gate, unbuilt steps, the wrong role, an unaccounted row, any other failure, an interrupted job", () => {
    expect([...UPSTREAM_SQL_IMPORT_TRANSFORM_ERROR_CODES]).toEqual([
      "REAL_DATA_NOT_ALLOWED",
      "TRANSFORM_NOT_BUILT",
      "TRANSFORM_ROLE_INVALID",
      "TRANSFORM_INCOMPLETE",
      "TRANSFORM_FAILED",
      "INTERRUPTED",
    ]);
  });

  it("the quarantine reasons the specs name are all there, as unique lower-case codes; 05's `device_not_found` is `no_device`", () => {
    for (const reason of [
      "no_device",
      "duplicate_header",
      "value_out_of_range",
      "facility_mapping_ambiguous",
      "group_conflict",
      "qr_case_collision",
      "future_calibration_date",
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
    ]) {
      expect(UPSTREAM_IMPORT_QUARANTINE_REASONS).toContain(reason);
    }
    expect(UPSTREAM_IMPORT_QUARANTINE_REASONS).not.toContain("device_not_found");
    expect(UPSTREAM_IMPORT_QUARANTINE_REASONS).toHaveLength(18);
    expect(new Set(UPSTREAM_IMPORT_QUARANTINE_REASONS).size).toBe(UPSTREAM_IMPORT_QUARANTINE_REASONS.length);
    expect(UPSTREAM_IMPORT_QUARANTINE_REASONS.every((r) => /^[a-z][a-z0-9_]{0,39}$/.test(r))).toBe(true);
    expect(Object.isFrozen(UPSTREAM_IMPORT_QUARANTINE_REASONS)).toBe(true);
  });
});
