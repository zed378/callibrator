/**
 * What steps 11 and 12 of the transform share (P24-02g; ADR-129 Am. 9; P19-02 spec § 13, § 4;
 * P19-01 spec § 5.1; 04 § 4.8, § 4.9, § 5; 05 § 3.3, § 3.4): the upstream IPM tables, the session
 * key, the staged-row read, the code → value maps, one result's values, and the fingerprints a
 * re-run compares.
 *
 * THE SESSION KEY (05 § 3.3, decided in Am. 9): upstream has no session row; a session is the device's
 * QR and the DAY of `created_at`. `created_at` is read in the source zone (UD-7) and the day is taken
 * in the tenant's IPM zone (the zone its reports are numbered in, default Asia/Jakarta) — so the
 * key is the local day of the real instant, and with both zones Asia/Jakarta it is upstream's own
 * `DATE(created_at)`. `legacy_key` = `<qr>|<YYYY-MM-DD>` (≤ 64, 0126's column).
 *
 * THE FINGERPRINTS (Am. 9): an imported session is submitted, and so append-only (0127). A re-run
 * never changes it: when the staged rows of an existing key still describe what was imported, they
 * are mapped onto it; when they do not, they are quarantined `session_changed_upstream` and the
 * operator corrects or voids the session through the application (P19-02 § 7.2). The comparison is
 * over the values the import derives from upstream — never ids, the catalogue match or anything
 * computed from it — so a delete-and-reinsert upstream (new ids, same content, 03 § 4.6) is a no-op.
 */
import { sql } from "../../../utils/sql.util";
import {
  DEFAULT_TIME_ZONE,
  INSPECTION_SECTION_RULES,
  evaluate,
  isTimeZone,
  parseDecimal,
  zonedDay,
  type InspectionCleanliness,
  type InspectionLimitOp,
  type InspectionOutcome,
  type InspectionOverallOutcome,
  type InspectionRecommendation,
  type InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import { IPM_SETTING_KEYS } from "../../ipmSettings.service";
import { cleanText } from "./catalogue";
import { textOf } from "./inventory";
import { classifiedSql, stagedTable } from "./ledger";
import type { StepContext, TransformSource } from "./steps";

/** A staged row's decision against `id_map`. */
export type Decision = "new" | "unchanged" | "changed";

/** The four per-session tables (step 11): one row per session each. */
export const SESSION_TABLES = Object.freeze(["trx_hasil_pemeriksaan", "trx_hasil_maintenance", "trx_rekomendasi_hasil_pekerjaan", "trx_catatan"] as const);
export type SessionTable = (typeof SESSION_TABLES)[number];

/** Where an upstream result table's item reference points (the catalogue step's source). */
interface ItemReference {
  readonly column: string;
  readonly catalogue: string;
}

/** One upstream result table: its section (P19-01 § 5.1) and its item reference, if it has one (03 § 4.6). */
export interface ResultTableRule {
  readonly section: InspectionSection;
  readonly item: ItemReference | null;
}

const ref = (column: string, catalogue: string): ItemReference => Object.freeze({ column, catalogue });

/** The twelve result tables (step 12), in 05 § 3.1's order. */
export const RESULT_TABLES: Readonly<Record<string, ResultTableRule>> = Object.freeze({
  trx_alat_kerja_digunakan: { section: "tools_used", item: ref("id_alat_kerja_digunakan", "mst_alat_kerja_digunakan") },
  trx_battery: { section: "battery", item: null },
  trx_fungsi_alat: { section: "function", item: ref("id_pemeriksaan_fungsi_alat", "mst_pemeriksaan_fungsi_alat") },
  trx_keamanan_listrik: { section: "electrical_safety", item: ref("id_keamanan_listrik", "mst_pemeriksaan_keamanan_listrik") },
  trx_kelengkapan_alat: { section: "completeness", item: ref("id_kelengkapan_alat", "mst_kelengkapan_alat") },
  trx_kinerja_alat: { section: "performance", item: ref("id_kinerja_alat", "mst_pemeriksaan_kinerja_alat") },
  trx_kondisi_kelistrikan: { section: "electrical_supply", item: null },
  trx_kondisi_lingkungan: { section: "environment", item: ref("id_kondisi_lingkungan", "mst_kondisi_lingkungan") },
  trx_konsumabel: { section: "consumable", item: null },
  trx_pemeliharaan_alat: { section: "maintenance_task", item: null },
  trx_pemeriksaan_fisik: { section: "physical", item: ref("id_pemeriksaan_fisik", "mst_pemeriksaan_fisik") },
  trx_pemeriksaan_keamanan_lain: { section: "other_safety", item: null },
});

/** The environment table: its `visit` is the session's legacy visit number, its `id_user` the performer (P19-02 § 13). */
export const ENVIRONMENT_TABLE = "trx_kondisi_lingkungan";

const keyed = (table: string): TransformSource => Object.freeze({ table, legacyId: 's."id"::text' });

/** Step 11's sources: the four per-session tables, keyed by their ids. */
export const SESSION_SOURCES: readonly TransformSource[] = Object.freeze(SESSION_TABLES.map(keyed));
/** Step 12's sources: the twelve result tables, keyed by their ids. */
export const RESULT_SOURCES: readonly TransformSource[] = Object.freeze(Object.keys(RESULT_TABLES).map(keyed));

// ------------------------------------------------------------------
// THE STAGED ROWS AND THE KEY
// ------------------------------------------------------------------

/** One staged IPM row: its classification, its QR, its instant (ISO UTC, ms; null when absent), its columns. */
export interface StagedIpmRow {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  qr: string | null;
  performedAt: string | null;
  row: Readonly<Record<string, unknown>>;
}

/** The run's staged rows of one IPM table, classified, with the QR and `created_at` read in the source zone. */
export const readStagedIpm = (context: StepContext, source: TransformSource): Promise<StagedIpmRow[]> =>
  sql<StagedIpmRow>(
    context.runner,
    `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
            nullif(btrim(to_jsonb(s) ->> 'no_qrcode'), '') AS qr,
            to_char(((to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "performedAt",
            to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row
       FROM (${classifiedSql(source)}) c
       JOIN ${stagedTable(source.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
      ORDER BY s.source_row_number`,
    [context.runId, context.sourceZone],
    { transaction: context.transaction },
  );

/** The tenant's IPM zone (`tenant_time_zone`, else the default) and its name. */
export const tenantOf = async (context: StepContext): Promise<{ name: string | null; zone: string }> => {
  const [tenant] = await sql<{ name: string | null; zone: string | null }>(
    context.runner,
    `SELECT t.name, z.value AS zone FROM tenants t
       LEFT JOIN tenant_settings z ON z.tenant_id = $1 AND z.key = $2
      WHERE t.id = $1`,
    [context.tenantId, IPM_SETTING_KEYS.timeZone],
    { transaction: context.transaction },
  );
  const zone = tenant?.zone ?? null;
  return { name: tenant?.name ?? null, zone: zone !== null && isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE };
};

/** The longest `legacy_key` (0126: varchar(64)). */
export const LEGACY_KEY_MAX = 64;

/** `<qr>|<YYYY-MM-DD>` — the day of the instant in `zone`; null when either part is missing or the key is too long. */
export const legacyKeyOf = (qr: string | null, performedAt: string | null, zone: string): string | null => {
  if (qr === null || performedAt === null) {
    return null;
  }
  const day = zonedDay(new Date(performedAt), zone);
  const key = `${qr}|${String(day.year)}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
  return key.length > LEGACY_KEY_MAX ? null : key;
};

/** Numeric legacy-id order, ties by the text. */
export const byLegacyId = <R extends { legacyId: string }>(a: R, b: R): number => Number(a.legacyId) - Number(b.legacyId) || a.legacyId.localeCompare(b.legacyId);

// ------------------------------------------------------------------
// CODES (04 § 5, P19-01 § 5.1 G-1)
// ------------------------------------------------------------------

/** `trx_hasil_pemeriksaan`, `trx_hasil_maintenance`: 1 / 0. */
export const OVERALL_CODES: Readonly<Record<string, InspectionOverallOutcome>> = Object.freeze({ "1": "pass", "0": "fail" });

/** `trx_rekomendasi_hasil_pekerjaan`: 1 / 0 / −1 / −2. */
export const RECOMMENDATION_CODES: Readonly<Record<string, InspectionRecommendation>> = Object.freeze({
  "1": "fit_for_use",
  "0": "needs_calibration",
  "-1": "not_fit_for_use",
  "-2": "needs_repair",
});

const TRI: Readonly<Record<string, InspectionOutcome>> = { "1": "pass", "0": "fail", "-1": "not_applicable" };
const CHECK: Readonly<Record<string, InspectionOutcome>> = { "1": "done", "0": "not_done" };
const PASS_FAIL: Readonly<Record<string, InspectionOutcome>> = { "1": "pass", "0": "fail" };
const MEASURED: Readonly<Record<string, InspectionOutcome | null>> = { "1": null, "-1": "not_applicable" };

/** A result's `status` code → its outcome, per section; a code mapped to null is "measured" (the value is the answer). */
export const RESULT_CODES: Readonly<Record<InspectionSection, Readonly<Record<string, InspectionOutcome | null>>>> = Object.freeze({
  environment: {},
  electrical_supply: MEASURED,
  tools_used: CHECK,
  other_safety: TRI,
  physical: { "1": "good", "0": "minor_damage", "-1": "major_damage" },
  electrical_safety: MEASURED,
  function: TRI,
  completeness: TRI,
  performance: PASS_FAIL,
  battery: PASS_FAIL,
  maintenance_task: CHECK,
  consumable: { "1": "available", "0": "not_available", "-1": "empty" },
});

const CLEANLINESS: Readonly<Record<string, InspectionCleanliness>> = { "1": "clean", "0": "dirty" };

/** A code as text (trimmed), or null when absent or empty. */
export const codeOf = (row: Readonly<Record<string, unknown>>, column: string): string | null => {
  const text = (textOf(row, column) ?? "").trim();
  return text === "" ? null : text;
};

/** A session note (`trx_catatan.description`): control characters but line breaks dropped, trimmed, ≤ 4000 (0126's CHECK); empty → null. */
export const noteOf = (raw: string | null): string | null => {
  const text = (raw ?? "").replace(/[^\P{Cc}\n\t]/gu, " ").trim().slice(0, 4000).trim();
  return text === "" ? null : text;
};

// ------------------------------------------------------------------
// ONE RESULT (P19-02 § 13 "Results")
// ------------------------------------------------------------------

/** What step 12 reads of an item definition: its section, label, unit and limit. */
export interface DefinitionFacts {
  id: string;
  section: string;
  label: string;
  unit: string | null;
  limitOp: InspectionLimitOp | null;
  limitValue: string | null;
  limitLow: string | null;
  limitHigh: string | null;
  limitNominal: string | null;
  limitTolerance: string | null;
  settingValue: string | null;
}

/** The values the import derives from one upstream row — what a re-run compares. */
export interface ComparableResult {
  section: InspectionSection;
  sortOrder: number;
  label: string;
  outcome: string | null;
  cleanliness: string | null;
  measuredValue: string | null;
  measuredValue1: string | null;
  measuredValue2: string | null;
  rawValue: string | null;
  setting: string | null;
  reference: string | null;
  symbol: string | null;
}

/** One result row as the import writes it (before its session, id and order are given). */
export interface ResultValues {
  section: InspectionSection;
  inputKind: string;
  itemDefinitionId: string | null;
  label: string;
  unit: string | null;
  symbol: string | null;
  setting: string | null;
  reference: string | null;
  outcome: InspectionOutcome | null;
  cleanliness: InspectionCleanliness | null;
  measuredValue: string | null;
  measuredValue1: string | null;
  measuredValue2: string | null;
  rawValue: string | null;
  computedOutcome: InspectionOverallOutcome | null;
  outcomeSource: "computed" | null;
  warnFlag: boolean;
}

/** The plausible range of the two environment readings (Q-21; 04 § 4.8): temperature °C, humidity %. */
export const ENVIRONMENT_RANGES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({ "1": [-20, 80], "2": [0, 100] });

const RAW_MAX = 255;

const textOrNull = (value: unknown, max: number): string | null => {
  const text = cleanText(value, max);
  return text === "" ? null : text;
};

/** A reading: the canonical decimal, or the verbatim text when it is not one (kept in `raw_value`). */
const readingOf = (raw: string | null, failed: string[]): string | null => {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const { value } = parseDecimal(raw);
  if (value === null) {
    failed.push(raw.trim());
  }
  return value;
};

/**
 * One upstream result row's values (pure), or null when it has no label (quarantined
 * `value_out_of_range`). Outcomes by the section's code map; a code the map does not know leaves
 * the outcome NULL and is kept verbatim in `raw_value`. Readings through `parseDecimal`, the text
 * kept on any failure; an environment reading outside its plausible range is NULL with the text
 * kept and `warn_flag`. Electrical safety has no imported outcome: `computed_outcome` from the
 * matched definition's limit where determinate (`outcome_source` computed), never the technician's.
 */
export const resultValuesOf = (table: string, row: Readonly<Record<string, unknown>>, definition: DefinitionFacts | null): ResultValues | null => {
  const rule = RESULT_TABLES[table] as ResultTableRule;
  const label = textOrNull(row["description"], 255);
  if (label === null) {
    return null;
  }
  const { section } = rule;
  const failed: string[] = [];
  const code = codeOf(row, "status");
  const codes = RESULT_CODES[section];
  const known = code !== null && Object.prototype.hasOwnProperty.call(codes, code);
  const outcome = known ? (codes[code] ?? null) : null;
  if (code !== null && !known) {
    failed.push(code);
  }
  const notApplicable = outcome === "not_applicable";
  const value = notApplicable ? null : readingOf(textOf(row, "value"), failed);
  let measuredValue = value;
  let warnFlag = false;
  const range = section === "environment" && rule.item !== null ? ENVIRONMENT_RANGES[codeOf(row, rule.item.column) ?? ""] : undefined;
  if (range !== undefined && value !== null && (Number(value) < range[0] || Number(value) > range[1])) {
    measuredValue = null;
    warnFlag = true;
    failed.push((textOf(row, "value") as string).trim());
  }
  const twoReadings = section === "performance" || section === "battery";
  const measuredValue1 = twoReadings ? readingOf(textOf(row, "terukur_1"), failed) : null;
  const measuredValue2 = twoReadings ? readingOf(textOf(row, "terukur_2"), failed) : null;
  const cleanlinessCode = section === "physical" ? codeOf(row, "status_kebersihan") : null;
  const cleanliness = cleanlinessCode === null ? null : (CLEANLINESS[cleanlinessCode] ?? null);
  if (cleanlinessCode !== null && cleanliness === null) {
    failed.push(cleanlinessCode);
  }
  const computed = section === "electrical_safety" && definition?.limitOp != null && measuredValue !== null ? evaluate(definition, [measuredValue]) : null;
  return {
    section,
    inputKind: INSPECTION_SECTION_RULES[section].inputKinds[0] as string,
    itemDefinitionId: definition?.id ?? null,
    label,
    unit: definition?.unit ?? null,
    symbol: textOrNull(row["symbol"], 50),
    setting: twoReadings ? textOrNull(row["setting"], 50) : null,
    reference: section === "performance" ? textOrNull(row["nilai_acuan"], 100) : null,
    outcome,
    cleanliness,
    measuredValue,
    measuredValue1,
    measuredValue2,
    rawValue: failed.length === 0 ? null : failed.join(" | ").slice(0, RAW_MAX),
    computedOutcome: computed,
    outcomeSource: computed === null ? null : "computed",
    warnFlag,
  };
};

/** A result's comparable values. */
export const comparableOf = (r: ComparableResult): ComparableResult => ({
  section: r.section,
  sortOrder: r.sortOrder,
  label: r.label,
  outcome: r.outcome,
  cleanliness: r.cleanliness,
  measuredValue: r.measuredValue,
  measuredValue1: r.measuredValue1,
  measuredValue2: r.measuredValue2,
  rawValue: r.rawValue,
  setting: r.setting,
  reference: r.reference,
  symbol: r.symbol,
});

/** The fingerprint of a session's results: the comparable values in section and order. */
export const resultsFingerprint = (results: readonly ComparableResult[]): string =>
  JSON.stringify(
    results
      .map(comparableOf)
      .sort((a, b) => a.section.localeCompare(b.section) || a.sortOrder - b.sortOrder),
  );

/** What a re-run compares of a session's header. */
export interface ComparableSession {
  deviceId: string;
  performedAt: string;
  inspectionOutcome: string | null;
  maintenanceOutcome: string | null;
  recommendation: string | null;
  notes: string | null;
  legacyVisitNumber: number | null;
}

/** The fingerprint of a session's header. */
export const sessionFingerprint = (s: ComparableSession): string =>
  JSON.stringify([s.deviceId, s.performedAt, s.inspectionOutcome, s.maintenanceOutcome, s.recommendation, s.notes, s.legacyVisitNumber]);
