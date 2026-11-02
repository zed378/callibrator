/**
 * P25-03 (ADR-129 Am. 14; docs/UPSTREAM/09 § 2.1 – § 2.3): the field-by-field comparison of what
 * the upstream IPM report prints for one session (`ipm/pdf_ipm.php`) with what our report document
 * is built from. Pure: the service reads the rows and only the tally leaves.
 *
 * WRITTEN FROM THE LAYOUT AND THE RULES, NOT READ FROM THE TRANSFORM. A diff that reused ipm.ts's
 * maps or inventory.ts's cleaning would prove consistency, never correctness (CLAUDE.md § Evidence):
 * the code maps below are 09 § 2.2's printed words and 04 § 5, written here as literals, and the
 * cleaning rules are 03 Q-17 / Q-24.
 *
 * A field of a session is `equal` when upstream prints what we hold, `explained` when it differs
 * only by a documented rule (each named at its comparison), and `differs` otherwise.
 */
import type {
  ReportDiffFieldResult,
  UpstreamReportDiffField,
} from "@callibrator/contracts/upstreamReportDiff";

export type Verdict = "equal" | "explained" | "differs";
type Raw = Readonly<Record<string, unknown>>;

/** One staged IPM row of a session's key (QR, day). */
export interface StagedReportRow {
  table: string;
  row: Raw;
  /** The stored row its mapping names; null when it has none. */
  targetId: string | null;
  quarantined: boolean;
}

/** The staged upstream account behind an `id_user`. */
export interface StagedUser {
  name: string | null;
  imported: boolean;
}

/** A stored result, as the report document reads it. */
export interface StoredResult {
  id: string;
  label: string | null;
  outcome: string | null;
  cleanliness: string | null;
  measuredValue: string | null;
  measuredValue1: string | null;
  measuredValue2: string | null;
  rawValue: string | null;
  setting: string | null;
  reference: string | null;
  symbol: string | null;
  warnFlag: boolean;
}

/** The stored session, as the report document reads it. */
export interface StoredSession {
  day: string | null;
  device: {
    name?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    qrCode?: string | null;
  };
  facilityName: string | null;
  room: string | null;
  performerName: string | null;
  legacyVisitNumber: number | null;
  inspectionOutcome: string | null;
  maintenanceOutcome: string | null;
  recommendation: string | null;
  notes: string | null;
  results: readonly StoredResult[];
}

/** One sampled session: both sides of the page. */
export interface ReportCase {
  /** The key's day, as upstream's `DATE(created_at)` selects the rows. */
  day: string;
  device: Raw | null;
  facilityName: string | null;
  /** Another device of the same upstream facility has this serial (UD-9). */
  serialShared: boolean;
  rows: readonly StagedReportRow[];
  users: ReadonlyMap<string, StagedUser>;
  stored: StoredSession;
}

const textOf = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** 03 Q-24: control characters and runs of white space collapse, ends trimmed. */
const cleaned = (value: string): string =>
  value.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Text as printed. `explained`: whitespace cleaned (03 Q-24); with `foldCase` also a case
 * variant, for what the import merges case-insensitively (rooms, facilities, QR normalisation).
 */
export const compareText = (raw: unknown, stored: string | null | undefined, foldCase = false): Verdict => {
  const source = textOf(raw);
  const held = stored ?? "";
  if (source === held) {
    return "equal";
  }
  const clean = cleaned(source);
  if (clean === held) {
    return "explained";
  }
  return foldCase && clean.toLowerCase() === held.toLowerCase() ? "explained" : "differs";
};

/** 03 Q-17's placeholders, written from the finding. */
const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  "none", "null", "nil", "n/a", "na", "tidak ada", "tidak", "kosong", "unknown", "tanpa sn", "no sn",
]);

const isPlaceholder = (raw: string): boolean => {
  const text = cleaned(raw).toLowerCase();
  return text.length < 3 || /^[-0.\s/]+$/.test(text) || PLACEHOLDER_WORDS.has(text);
};

/** The serial: a placeholder (03 Q-17) or a duplicate inside the facility (UD-9) stored NULL is explained. */
export const compareSerial = (raw: unknown, stored: string | null | undefined, shared: boolean): Verdict => {
  if ((stored ?? null) !== null) {
    return compareText(raw, stored);
  }
  const source = textOf(raw);
  if (source === "") {
    return "equal";
  }
  return isPlaceholder(source) || shared ? "explained" : "differs";
};

const byId = (a: Raw, b: Raw): number => Number(a["id"]) - Number(b["id"]);

const codeOf = (row: Raw, column = "status"): string | null => {
  const text = textOf(row[column]).trim();
  return text === "" ? null : text;
};

/**
 * A one-row-per-session code. Two rows for one key: the highest id is the session's (03 Q-8), and a
 * lower row that says otherwise is `explained`. An unknown code stored NULL is `explained`.
 */
export const compareCoded = (rows: readonly Raw[], codes: Readonly<Record<string, string>>, stored: string | null): Verdict => {
  const sorted = [...rows].sort(byId);
  const winner = sorted.at(-1);
  if (winner === undefined) {
    return stored === null ? "equal" : "differs";
  }
  const code = codeOf(winner);
  if (code !== null && !Object.prototype.hasOwnProperty.call(codes, code)) {
    return stored === null ? "explained" : "differs";
  }
  if ((code === null ? null : codes[code]) !== stored) {
    return "differs";
  }
  return sorted.some((r) => codeOf(r) !== code) ? "explained" : "equal";
};

/** A number as upstream's readings write it (one `,` or `.` as the point), else null. */
const numberOf = (text: string): number | null =>
  /^[+-]?\d+([.,]\d+)?$/.test(text) ? Number(text.replace(",", ".")) : null;

const EPSILON = 1e-6;

/** One reading. Numerically equal is `equal` (a decimal comma prints the same number); the rest by 03 Q-21, Q-23. */
export const compareReading = (
  raw: unknown,
  stored: string | null,
  result: Pick<StoredResult, "rawValue" | "warnFlag">,
  notApplicable: boolean,
): Verdict => {
  const text = textOf(raw).trim();
  if (text === "") {
    return stored === null ? "equal" : "differs";
  }
  if (notApplicable && stored === null) {
    return "explained"; // 09 § 2.2: "N/A" is printed whatever the column holds.
  }
  const value = numberOf(text);
  if (stored === null) {
    const kept = (result.rawValue ?? "").includes(text);
    return kept && (value === null || result.warnFlag) ? "explained" : "differs";
  }
  return value !== null && Math.abs(value - Number(stored)) < EPSILON ? "equal" : "differs";
};

const worst = (verdicts: readonly Verdict[]): Verdict => {
  if (verdicts.includes("differs")) {
    return "differs";
  }
  return verdicts.includes("explained") ? "explained" : "equal";
};

const TRI = { "1": "pass", "0": "fail", "-1": "not_applicable" };
const CHECK = { "1": "done", "0": "not_done" };
const PASS_FAIL = { "1": "pass", "0": "fail" };
/** The value is the answer; -1 prints N/A (09 § 2.2 item 3). */
const MEASURED = { "1": null, "-1": "not_applicable" };

/** 09 § 2.2's sections: what each `status` code prints, as the outcome we hold for that word. */
const RESULT_PRINT: Readonly<Record<string, Readonly<Record<string, string | null>> | null>> = Object.freeze({
  trx_kondisi_lingkungan: null,
  trx_kondisi_kelistrikan: MEASURED,
  trx_alat_kerja_digunakan: CHECK,
  trx_pemeriksaan_keamanan_lain: TRI,
  trx_pemeriksaan_fisik: { "1": "good", "0": "minor_damage", "-1": "major_damage" },
  trx_keamanan_listrik: MEASURED,
  trx_fungsi_alat: TRI,
  trx_kelengkapan_alat: TRI,
  trx_kinerja_alat: PASS_FAIL,
  trx_battery: PASS_FAIL,
  trx_pemeliharaan_alat: CHECK,
  trx_konsumabel: { "1": "available", "0": "not_available", "-1": "empty" },
});

const CLEANLINESS: Readonly<Record<string, string>> = { "1": "clean", "0": "dirty" };

const isResultTable = (table: string): boolean => Object.prototype.hasOwnProperty.call(RESULT_PRINT, table);

/** A row's printed code against the stored outcome. A code the section does not print is stored NULL, the text kept. */
const compareOutcome = (table: string, row: Raw, stored: StoredResult): Verdict => {
  const codes = RESULT_PRINT[table];
  if (codes === null || codes === undefined) {
    return stored.outcome === null ? "equal" : "differs";
  }
  const code = codeOf(row);
  if (code === null) {
    return stored.outcome === null ? "equal" : "differs";
  }
  if (!Object.prototype.hasOwnProperty.call(codes, code)) {
    return stored.outcome === null && (stored.rawValue ?? "").includes(code) ? "explained" : "differs";
  }
  return (codes[code] ?? null) === stored.outcome ? "equal" : "differs";
};

/** One landed result row: its label, code, cleanliness, readings and printed texts. */
export const compareResultRow = (table: string, row: Raw, stored: StoredResult): Verdict => {
  const notApplicable = stored.outcome === "not_applicable";
  const twoReadings = table === "trx_kinerja_alat" || table === "trx_battery";
  const verdicts: Verdict[] = [
    compareText(row["description"], stored.label),
    compareOutcome(table, row, stored),
    compareReading(row["value"], stored.measuredValue, stored, notApplicable),
    compareText(row["symbol"], stored.symbol),
  ];
  if (twoReadings) {
    verdicts.push(
      compareReading(row["terukur_1"], stored.measuredValue1, stored, notApplicable),
      compareReading(row["terukur_2"], stored.measuredValue2, stored, notApplicable),
      compareText(row["setting"], stored.setting),
    );
  }
  if (table === "trx_kinerja_alat") {
    verdicts.push(compareText(row["nilai_acuan"], stored.reference));
  }
  if (table === "trx_pemeriksaan_fisik") {
    const code = codeOf(row, "status_kebersihan");
    const known = code === null ? null : (CLEANLINESS[code] ?? undefined);
    verdicts.push(known === stored.cleanliness ? "equal" : known === undefined && stored.cleanliness === null ? "explained" : "differs");
  }
  return worst(verdicts);
};

const ENVIRONMENT = "trx_kondisi_lingkungan";

/** The session's rows of one table, lowest id first. */
const rowsOf = (rows: readonly StagedReportRow[], table: string): Raw[] =>
  rows.filter((r) => r.table === table).map((r) => r.row).sort(byId);

/** "Visit ke": the environment rows' `visit`, carried as the legacy number; 0 or empty is none (09 L-5). */
export const compareVisit = (rows: readonly StagedReportRow[], stored: number | null): Verdict => {
  const visits = rowsOf(rows, ENVIRONMENT).map((r) => textOf(r["visit"]).trim());
  const first = visits.find((v) => /^\d{1,5}$/.test(v) && Number(v) >= 1);
  if (first !== undefined) {
    return Number(first) === stored ? "equal" : "differs";
  }
  if (stored !== null) {
    return "differs";
  }
  return visits.some((v) => v !== "") ? "explained" : "equal";
};

const FORMER_USER = "Former upstream user #";
const NO_USER = "Upstream import";
const UNNAMED = "Unnamed user";

/**
 * "Teknisi Pelaksana": the user of the first environment row (09 § 2.3), else of any of the key's
 * rows. A person who is no imported account prints a numbered snapshot, a key with no user
 * "Upstream import", an account with no name "Unnamed user" (07 § 3, ADR-139 § 6): explained.
 */
export const compareTechnician = (
  rows: readonly StagedReportRow[],
  users: ReadonlyMap<string, StagedUser>,
  stored: string | null,
): Verdict => {
  const candidates = [...rowsOf(rows, ENVIRONMENT), ...rows.map((r) => r.row)]
    .map((r) => textOf(r["id_user"]).trim())
    .filter((id) => id !== "");
  const legacy = candidates[0];
  if (legacy === undefined) {
    return stored === NO_USER ? "explained" : "differs";
  }
  const user = users.get(legacy);
  if (user?.imported !== true) {
    return stored?.startsWith(FORMER_USER) === true ? "explained" : "differs";
  }
  if (stored === UNNAMED && cleaned(user.name ?? "") === "") {
    return "explained";
  }
  return compareText(user.name, stored);
};

/** The results' rows: a row the import quarantined is `explained`, a row lost is `differs`. */
export const compareRowCount = (rows: readonly StagedReportRow[], stored: number): Verdict => {
  const source = rows.filter((r) => isResultTable(r.table));
  if (source.length === stored) {
    return "equal";
  }
  const landed = source.filter((r) => r.targetId !== null).length;
  return landed === stored && source.every((r) => r.targetId !== null || r.quarantined) ? "explained" : "differs";
};

/** Every landed result row against its stored result. */
export const compareValues = (rows: readonly StagedReportRow[], results: readonly StoredResult[]): Verdict => {
  const byTarget = new Map(results.map((r) => [r.id, r]));
  return worst(
    rows
      .filter((r) => isResultTable(r.table) && r.targetId !== null)
      .map((r) => {
        const stored = byTarget.get(r.targetId as string);
        return stored === undefined ? "differs" : compareResultRow(r.table, r.row, stored);
      }),
  );
};

const OVERALL = { "1": "pass", "0": "fail" };
const RECOMMENDATION = { "1": "fit_for_use", "0": "needs_calibration", "-1": "not_fit_for_use", "-2": "needs_repair" };

/** The highest-id note of the key; several notes keep that one (03 Q-8). */
const compareNotes = (rows: readonly Raw[], stored: string | null): Verdict => {
  const sorted = [...rows].sort(byId);
  const verdict = compareText(cleaned(textOf(sorted.at(-1)?.["description"])), stored === null ? null : cleaned(stored));
  return verdict === "equal" && textOf(sorted.at(-1)?.["description"]) !== (stored ?? "") ? "explained" : verdict;
};

/** Every field of one sampled session. */
export const compareSession = (c: ReportCase): Readonly<Record<UpstreamReportDiffField, Verdict>> => {
  const { stored, device, rows } = c;
  const column = (name: string): unknown => device?.[name];
  return {
    "device.name": compareText(column("nama_alat"), stored.device.name),
    facility: compareText(c.facilityName, stored.facilityName, true),
    "ipm.date": c.day === stored.day ? "equal" : "differs",
    room: compareText(column("nama_ruangan"), stored.room, true),
    "device.qr": compareText(column("no_qrcode"), stored.device.qrCode, true),
    "device.brand": compareText(column("merk"), stored.device.manufacturer),
    "device.serial": compareSerial(column("sn"), stored.device.serialNumber, c.serialShared),
    "device.model": compareText(column("type"), stored.device.model),
    visit: compareVisit(rows, stored.legacyVisitNumber),
    "results.rows": compareRowCount(rows, stored.results.length),
    "results.values": compareValues(rows, stored.results),
    "inspection.result": compareCoded(rowsOf(rows, "trx_hasil_pemeriksaan"), OVERALL, stored.inspectionOutcome),
    "maintenance.result": compareCoded(rowsOf(rows, "trx_hasil_maintenance"), OVERALL, stored.maintenanceOutcome),
    recommendation: compareCoded(rowsOf(rows, "trx_rekomendasi_hasil_pekerjaan"), RECOMMENDATION, stored.recommendation),
    notes: compareNotes(rowsOf(rows, "trx_catatan"), stored.notes),
    technician: compareTechnician(rows, c.users, stored.performerName),
  };
};

/** What `explained` means per field: fixed text, never a value. */
export const REPORT_DIFF_NOTES: Readonly<Record<UpstreamReportDiffField, string>> = Object.freeze({
  "device.name": "the printed device name; explained: whitespace cleaned (03 Q-24)",
  facility: "the facility of the upstream device; explained: whitespace or case of a merged facility (03 Q-24)",
  "ipm.date": "the day of the session's key against the day of performed_at in the tenant's zone",
  room: "the device's room; explained: whitespace, or the case of a merged room (03 Q-24)",
  "device.qr": "the QR number; explained: whitespace or the register's case normalisation",
  "device.brand": "the brand; explained: whitespace cleaned (03 Q-24)",
  "device.serial": "the serial; explained: a placeholder (03 Q-17) or a duplicate inside the facility (UD-9) stored NULL",
  "device.model": "the model; explained: whitespace cleaned (03 Q-24)",
  visit: "upstream's visit flag against the carried legacy number; explained: 0 or not a number is none (09 L-5)",
  "results.rows": "the session's result rows; explained: rows the import quarantined, each with its reason",
  "results.values": "labels, codes and readings row by row; explained: text kept raw (03 Q-21, Q-23), an unknown code, N/A",
  "inspection.result": "upstream never prints it (09 L-2): the stored outcome against the header's code; explained: a duplicate header or an unknown code",
  "maintenance.result": "the printed maintenance result; explained: a duplicate row or an unknown code",
  recommendation: "the printed recommendation; explained: a duplicate row or an unknown code",
  notes: "the printed note; explained: whitespace cleaned",
  technician: "the performer; explained: a departed user's numbered snapshot, no user, or no name (07 § 3)",
});

/** The sessions' verdicts as the contract's field results, in the print order given. */
export const tallyFields = (
  fields: readonly UpstreamReportDiffField[],
  cases: readonly Readonly<Record<UpstreamReportDiffField, Verdict>>[],
): ReportDiffFieldResult[] =>
  fields.map((field) => {
    const count = (verdict: Verdict): number => cases.filter((c) => c[field] === verdict).length;
    const differs = count("differs");
    return {
      field,
      status: differs === 0 ? "pass" : "fail",
      compared: cases.length,
      equal: count("equal"),
      explained: count("explained"),
      differs,
      note: REPORT_DIFF_NOTES[field],
    };
  });
