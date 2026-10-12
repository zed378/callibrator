/**
 * The transform's steps (P24-01; docs/UPSTREAM/05 § 3.1, as amended by P19-04 § 15): the order
 * in which stage 2 turns the staged upstream tables into the application's rows, and WHICH STEP
 * ACCOUNTS FOR EACH STAGED TABLE.
 *
 * Every staged table (tablePolicy.ts STAGED_TABLES) is the source of exactly one step
 * (`transformSteps.p2401` holds that), so the runner can prove after the last step that every
 * staged row of the run is in `upstream_import.id_map` or in `upstream_import.quarantine` —
 * nothing dropped silently (05 § 1.2). Steps 6, 7 and 13 write rows DERIVED from other tables
 * (distinct laboratories, distinct rooms, the per-row audit rows) and own no source table.
 *
 * A step's `run` and each source's `legacyId` are P24-02's (built part by part: P24-02a the
 * facilities and the audit rows, P24-02b the users, P24-02c the catalogue): until EVERY step has both, the transform is not built, and the transform is not available (`transformAvailable()` false, the request 409,
 * the worker `TRANSFORM_NOT_BUILT`). `legacyId` is an SQL expression over the staged row,
 * aliased `s` — a constant of this module, never input — giving the text key the step writes
 * to `id_map.legacy_id` (usually `s."id"::text`; a session's `legacy_key`, 05 § 3.3).
 */
import type { Transaction } from "sequelize";
import type { SqlRunner } from "../../../utils/sql.util";
import { FACILITY_SOURCE, runClientFacilities } from "./clientFacilities";
import { runAuditRows } from "./auditRows";
import { USER_SOURCES, runUsers } from "./users";
import { DEFINITION_SOURCES, DEVICE_TYPE_SOURCE, runDeviceTypes, runItemDefinitions } from "./catalogue";

/** What a step's `run` receives: the run, and the transform connection's transaction. */
export interface StepContext {
  /** The run whose staged rows (`import_run_id`) the step reads. Bound as a parameter, never interpolated. */
  readonly runId: string;
  /** The transform connection (switched to the transform role), for `sql()`. */
  readonly runner: SqlRunner;
  /** The run's ONE transform transaction: a failure anywhere rolls every step back. */
  readonly transaction: Transaction;
  /** P24-02a: the PROVIDER tenant every tenant-owned row lands in (the run's `transformTenantId`). Bound, never interpolated. */
  readonly tenantId: string;
  /** P24-02a (UD-7, 05 § 3.4): the IANA zone upstream's naive DATETIME values are read in. Bound, never interpolated. */
  readonly sourceZone: string;
}

/** One staged table a step accounts for. */
export interface TransformSource {
  /** The upstream table (staged as `upstream_import.stg_<table>`). */
  readonly table: string;
  /** The SQL expression over `s` giving the row's `id_map.legacy_id`; null until P24-02 writes the step. */
  readonly legacyId: string | null;
}

/** One step of 05 § 3.1. */
export interface TransformStep {
  /** A lower-case code (the summary's `step`). */
  readonly id: string;
  /** The application table(s) it writes — documentation, and the grants P24-02 gives the transform role. */
  readonly writes: readonly string[];
  readonly sources: readonly TransformSource[];
  /** The step itself; null until P24-02 builds it. */
  readonly run: ((context: StepContext) => Promise<void>) | null;
}

const NOT_BUILT = null;

const sources = (...tables: string[]): readonly TransformSource[] =>
  Object.freeze(tables.map((table) => Object.freeze({ table, legacyId: NOT_BUILT })));

const step = (
  id: string,
  writes: readonly string[],
  from: readonly TransformSource[],
  run: TransformStep["run"] = NOT_BUILT,
): TransformStep => Object.freeze({ id, writes: Object.freeze([...writes]), sources: from, run });

/** 05 § 3.1 as amended by P19-04 § 15 (the provider tenant first, then its client facilities). */
export const TRANSFORM_STEPS: readonly TransformStep[] = Object.freeze([
  // P24-02a: the provider tenant proved, then its client facilities (clientFacilities.ts).
  step("client_facilities", ["client_facilities"], Object.freeze([FACILITY_SOURCE]), runClientFacilities),
  // P24-02b: users, their groups, memberships and facility mappings (users.ts).
  step(
    "users",
    ["users"],
    Object.freeze([USER_SOURCES.users, USER_SOURCES.groups, USER_SOURCES.memberships, USER_SOURCES.mappings]),
    runUsers,
  ),
  // P24-02c: the global catalogue — device types, then the item library (catalogue.ts).
  step("device_types", ["device_types"], Object.freeze([DEVICE_TYPE_SOURCE]), runDeviceTypes),
  step("inspection_item_definitions", ["inspection_item_definitions"], DEFINITION_SOURCES, runItemDefinitions),
  step(
    "inspection_templates",
    ["inspection_templates", "inspection_template_versions", "inspection_template_items"],
    sources("mapping_fugsi_alat", "mapping_alat_kerja_digunakan", "mapping_keamanan_listrik", "mapping_kelengkapan_alat", "mapping_kinerja_alat"),
  ),
  step("vendors", ["vendors"], sources()),
  step("warehouses", ["warehouses"], sources()),
  step("calibration_devices", ["calibration_devices"], sources("trx_inventory")),
  step("attachments", ["attachments"], sources("trx_inventory_file")),
  step("calibration_records", ["calibration_records"], sources("trx_kalibrasi")),
  step("inspection_sessions", ["inspection_sessions"], sources("trx_hasil_pemeriksaan")),
  step(
    "inspection_results",
    ["inspection_results"],
    sources(
      "trx_alat_kerja_digunakan",
      "trx_battery",
      "trx_catatan",
      "trx_fungsi_alat",
      "trx_hasil_maintenance",
      "trx_keamanan_listrik",
      "trx_kelengkapan_alat",
      "trx_kinerja_alat",
      "trx_kondisi_kelistrikan",
      "trx_kondisi_lingkungan",
      "trx_konsumabel",
      "trx_pemeliharaan_alat",
      "trx_pemeriksaan_fisik",
      "trx_pemeriksaan_keamanan_lain",
      "trx_rekomendasi_hasil_pekerjaan",
    ),
  ),
  // P24-02a: one audit row per application row written in this transaction (auditRows.ts).
  step("audit_logs", ["audit_logs"], sources(), runAuditRows),
]);

/** Whether every step, and every source's legacy key, is written. */
export const isBuilt = (steps: readonly TransformStep[]): boolean =>
  steps.every((s) => s.run !== null && s.sources.every((source) => source.legacyId !== null));
