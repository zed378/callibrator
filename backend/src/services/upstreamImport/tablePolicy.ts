/**
 * Which upstream tables and columns the SQL-dump import may stage (ADR-129,
 * P24-06) — `docs/UPSTREAM/07-DATA-MINIMISATION.md` written as code.
 *
 * DENY BY DEFAULT. A table is staged only when it is listed in STAGED; a
 * table listed in NOT_EXTRACTED, or not listed at all, has no extract step:
 * its rows are counted and dropped by the parser's consumer, never written
 * anywhere (07: "a NOT MIGRATED table has no extract step at all, so it cannot
 * leak into staging"). A NEVER COPIED column of a staged table is never
 * created in staging and its values are never bound.
 *
 * The names are upstream STRUCTURE (03 § 4), not data. A change to this list
 * is a change to 07 and needs its record.
 */

/** Why a table is not staged. */
export type NotStagedReason = "not_migrated" | "never_copied" | "not_in_policy";

/** A staged table: the columns that never enter staging. */
interface StagedTable {
  readonly excluded: readonly string[];
}

const NONE: StagedTable = Object.freeze({ excluded: Object.freeze([]) });

/**
 * The tables staged, with the columns 07 § 2.1 excludes. `users`: the
 * credential columns are NEVER COPIED (UD-5), the myth/auth internals and the
 * profile image NOT MIGRATED.
 */
const STAGED: Readonly<Record<string, StagedTable>> = Object.freeze({
  users: Object.freeze({
    excluded: Object.freeze([
      "password_hash",
      "reset_hash",
      "reset_at",
      "reset_expires",
      "activate_hash",
      "status",
      "status_message",
      "force_pass_reset",
      "user_image",
      "deleted_at",
    ]),
  }),
  // USE-ONLY (07 § 2.1): read by the transform to decide roles and facility scopes.
  auth_groups: NONE,
  auth_groups_users: NONE,
  trx_mapping_user_client: NONE,
  // Master data (07 § 2.2).
  mst_faskes: NONE,
  mst_alat: NONE,
  mst_kelengkapan_alat: NONE,
  mst_pemeriksaan_fungsi_alat: NONE,
  mst_pemeriksaan_kinerja_alat: NONE,
  mst_alat_kerja_digunakan: NONE,
  mst_pemeriksaan_keamanan_listrik: NONE,
  mst_kondisi_kelistrikan: NONE,
  mst_pemeliharaan_alat: NONE,
  mst_kondisi_lingkungan: NONE,
  mst_pemeriksaan_fisik: NONE,
  mst_pemeriksaan_keamanan_lain: NONE,
  mst_rekomendasi_hasil_pekerjaan: NONE,
  mapping_fugsi_alat: NONE,
  mapping_alat_kerja_digunakan: NONE,
  mapping_keamanan_listrik: NONE,
  mapping_kelengkapan_alat: NONE,
  mapping_kinerja_alat: NONE,
  // Inventory and calibration (07 § 2.3); trx_inventory_file is USE-ONLY (the archive index, F-CERT).
  trx_inventory: NONE,
  trx_inventory_file: NONE,
  trx_kalibrasi: NONE,
  // The 16 inspection / maintenance tables (07 § 2.4).
  trx_alat_kerja_digunakan: NONE,
  trx_battery: NONE,
  trx_catatan: NONE,
  trx_fungsi_alat: NONE,
  trx_hasil_maintenance: NONE,
  trx_hasil_pemeriksaan: NONE,
  trx_keamanan_listrik: NONE,
  trx_kelengkapan_alat: NONE,
  trx_kinerja_alat: NONE,
  trx_kondisi_kelistrikan: NONE,
  trx_kondisi_lingkungan: NONE,
  trx_konsumabel: NONE,
  trx_pemeliharaan_alat: NONE,
  trx_pemeriksaan_fisik: NONE,
  trx_pemeriksaan_keamanan_lain: NONE,
  trx_rekomendasi_hasil_pekerjaan: NONE,
});

/** The upstream tables 07 decides against, and why. Listed so the report can say which rule applied. */
const NOT_EXTRACTED: Readonly<Record<string, NotStagedReason>> = Object.freeze({
  // Login history (12 k rows of e-mail and IP): its purpose ends at cutover; the
  // coarse last-login bucket of 07 § 2.1 waits for counsel (⚖) and is not derived here.
  auth_logins: "not_migrated",
  auth_tokens: "never_copied",
  auth_reset_attempts: "never_copied",
  auth_activation_attempts: "never_copied",
  auth_permissions: "never_copied",
  auth_groups_permissions: "never_copied",
  auth_users_permissions: "never_copied",
  mst_fotodepan_inventory: "not_migrated",
  mst_fotosn_inventory: "not_migrated",
  mst_stok_konsumable: "not_migrated",
  migrations: "not_migrated",
});

/** What the policy decides for one table. */
export type TableDecision =
  | { readonly stage: true; readonly excluded: ReadonlySet<string> }
  | { readonly stage: false; readonly reason: NotStagedReason };

/**
 * The decision for a table, by its (lower-cased) upstream name.
 * @param table - the table's name as the parser reports it
 */
export const decideTable = (table: string): TableDecision => {
  const staged = Object.prototype.hasOwnProperty.call(STAGED, table) ? STAGED[table] : undefined;
  if (staged !== undefined) {
    return { stage: true, excluded: new Set(staged.excluded) };
  }
  const reason = Object.prototype.hasOwnProperty.call(NOT_EXTRACTED, table) ? NOT_EXTRACTED[table] : undefined;
  return { stage: false, reason: reason ?? "not_in_policy" };
};

/** Every staged table's name (the staging tables are `stg_<name>`). */
export const STAGED_TABLES: readonly string[] = Object.freeze(Object.keys(STAGED));

/** The staging table of an upstream table. */
export const stagingTableOf = (table: string): string => `stg_${table}`;
