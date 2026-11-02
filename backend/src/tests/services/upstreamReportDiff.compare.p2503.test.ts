/**
 * P25-03 — services/upstreamImport/reportDiff.ts, the field-by-field comparison. Written from
 * docs/UPSTREAM/09 § 2.2 (the printed words), 03 Q-8, Q-17, Q-21, Q-23, Q-24 and 07 § 3, not read
 * back from the transform: each case states what upstream prints and what we hold. Synthetic only.
 */
import {
  REPORT_DIFF_NOTES,
  compareCoded,
  compareReading,
  compareResultRow,
  compareRowCount,
  compareSerial,
  compareSession,
  compareTechnician,
  compareText,
  compareValues,
  compareVisit,
  tallyFields,
  type ReportCase,
  type StagedReportRow,
  type StagedUser,
  type StoredResult,
  type StoredSession,
  type Verdict,
} from "../../services/upstreamImport/reportDiff";
import { UPSTREAM_REPORT_DIFF_FIELDS, type UpstreamReportDiffField } from "@callibrator/contracts/upstreamReportDiff";

const result = (values: Partial<StoredResult> = {}): StoredResult => ({
  id: "r1",
  label: "Item sintetis",
  outcome: null,
  cleanliness: null,
  measuredValue: null,
  measuredValue1: null,
  measuredValue2: null,
  rawValue: null,
  setting: null,
  reference: null,
  symbol: null,
  warnFlag: false,
  ...values,
});
const staged = (table: string, row: Record<string, unknown>, targetId: string | null = "r1", quarantined = false): StagedReportRow => ({ table, row, targetId, quarantined });
const label = { description: "Item sintetis" };

describe("P25-03 reportDiff — text, serials and codes", () => {
  it("text: equal, cleaned, case folded only where asked, else differs; an absent value is the empty text", () => {
    expect(compareText("Pompa", "Pompa")).toBe("equal");
    expect(compareText(null, null)).toBe("equal");
    expect(compareText(12, "12")).toBe("equal");
    expect(compareText("  Pompa\t Infus ", "Pompa Infus")).toBe("explained");
    expect(compareText("pompa", "Pompa")).toBe("differs");
    expect(compareText("pompa", "Pompa", true)).toBe("explained");
    expect(compareText("Monitor", "Pompa", true)).toBe("differs");
    expect(compareText("   ", null)).toBe("explained");
  });

  it("serial: a stored value compares as text; NULL is explained by a placeholder or a duplicate, and nothing else", () => {
    expect(compareSerial("SN-123", "SN-123", false)).toBe("equal");
    expect(compareSerial(" SN-123", "SN-123", false)).toBe("explained");
    expect(compareSerial(null, null, false)).toBe("equal");
    for (const placeholder of ["-", "0", "00", "tidak ada", "N/A", "ab", "--/--"]) {
      expect(compareSerial(placeholder, null, false)).toBe("explained");
    }
    expect(compareSerial("SN-123", null, true)).toBe("explained");
    expect(compareSerial("SN-123", null, false)).toBe("differs");
  });

  it("a one-row code: the highest id decides, a lower row that disagrees is a duplicate, an unknown code is NULL", () => {
    const codes = { "1": "pass", "0": "fail" };
    expect(compareCoded([], codes, null)).toBe("equal");
    expect(compareCoded([], codes, "pass")).toBe("differs");
    expect(compareCoded([{ id: 1, status: "1" }], codes, "pass")).toBe("equal");
    expect(compareCoded([{ id: 1, status: "" }], codes, null)).toBe("equal");
    expect(compareCoded([{ id: 1, status: "0" }], codes, "pass")).toBe("differs");
    expect(compareCoded([{ id: 2, status: "0" }, { id: 1, status: "1" }], codes, "fail")).toBe("explained");
    expect(compareCoded([{ id: 2, status: "1" }, { id: 1, status: "1" }], codes, "pass")).toBe("equal");
    expect(compareCoded([{ id: 1, status: "7" }], codes, null)).toBe("explained");
    expect(compareCoded([{ id: 1, status: "7" }], codes, "pass")).toBe("differs");
    expect(compareCoded([{ id: 1, status: "constructor" }], codes, null)).toBe("explained");
  });
});

describe("P25-03 reportDiff — readings and result rows", () => {
  const facts = { rawValue: null, warnFlag: false };

  it("a reading: the number is what counts, a decimal comma prints the same number", () => {
    expect(compareReading("25,5", "25.50", facts, false)).toBe("equal");
    expect(compareReading(" 25.5 ", "25.5", facts, false)).toBe("equal");
    expect(compareReading("25,6", "25.5", facts, false)).toBe("differs");
    expect(compareReading("abc", "25.5", facts, false)).toBe("differs");
  });

  it("nothing staged, N/A, text kept raw (Q-23), a value out of range (Q-21); a lost reading differs", () => {
    expect(compareReading(null, null, facts, false)).toBe("equal");
    expect(compareReading("", "1", facts, false)).toBe("differs");
    expect(compareReading("5", null, facts, true)).toBe("explained");
    expect(compareReading("abc", null, { rawValue: "abc", warnFlag: false }, false)).toBe("explained");
    expect(compareReading("150", null, { rawValue: "150", warnFlag: true }, false)).toBe("explained");
    expect(compareReading("150", null, { rawValue: "150", warnFlag: false }, false)).toBe("differs");
    expect(compareReading("abc", null, facts, false)).toBe("differs");
  });

  it("a row's printed code against the outcome we hold, section by section (09 § 2.2)", () => {
    const row = (status: string): Record<string, unknown> => ({ ...label, status });
    expect(compareResultRow("trx_fungsi_alat", row("1"), result({ outcome: "pass" }))).toBe("equal");
    expect(compareResultRow("trx_fungsi_alat", row("-1"), result({ outcome: "not_applicable" }))).toBe("equal");
    expect(compareResultRow("trx_pemeriksaan_keamanan_lain", row("0"), result({ outcome: "fail" }))).toBe("equal");
    expect(compareResultRow("trx_pemeriksaan_fisik", row("-1"), result({ outcome: "major_damage" }))).toBe("equal");
    expect(compareResultRow("trx_konsumabel", row("-1"), result({ outcome: "empty" }))).toBe("equal");
    expect(compareResultRow("trx_pemeliharaan_alat", row("0"), result({ outcome: "not_done" }))).toBe("equal");
    expect(compareResultRow("trx_alat_kerja_digunakan", row("1"), result({ outcome: "done" }))).toBe("equal");
    expect(compareResultRow("trx_keamanan_listrik", row("1"), result())).toBe("equal");
    expect(compareResultRow("trx_kondisi_kelistrikan", row("-1"), result({ outcome: "not_applicable" }))).toBe("equal");
    expect(compareResultRow("trx_fungsi_alat", row("1"), result({ outcome: "fail" }))).toBe("differs");
    expect(compareResultRow("trx_fungsi_alat", row("9"), result({ rawValue: "9" }))).toBe("explained");
    expect(compareResultRow("trx_fungsi_alat", row("9"), result())).toBe("differs");
    expect(compareResultRow("trx_fungsi_alat", label, result())).toBe("equal");
    expect(compareResultRow("trx_fungsi_alat", label, result({ outcome: "pass" }))).toBe("differs");
    expect(compareResultRow("trx_kondisi_lingkungan", label, result({ outcome: "pass" }))).toBe("differs");
    expect(compareResultRow("trx_kondisi_lingkungan", { ...label, value: "25" }, result({ measuredValue: "25" }))).toBe("equal");
  });

  it("a label, a symbol, the two readings, the setting, the reference and the cleanliness", () => {
    expect(compareResultRow("trx_fungsi_alat", { description: "Lain" }, result())).toBe("differs");
    expect(compareResultRow("trx_keamanan_listrik", { ...label, symbol: "I", value: "5", status: "1" }, result({ symbol: "I", measuredValue: "5" }))).toBe("equal");
    const performance = { ...label, status: "1", terukur_1: "1,5", terukur_2: "2", setting: "60", nilai_acuan: "± 10" };
    const held = result({ outcome: "pass", measuredValue1: "1.5", measuredValue2: "2", setting: "60", reference: "± 10" });
    expect(compareResultRow("trx_kinerja_alat", performance, held)).toBe("equal");
    expect(compareResultRow("trx_kinerja_alat", { ...performance, nilai_acuan: "lain" }, held)).toBe("differs");
    expect(compareResultRow("trx_kinerja_alat", { ...performance, terukur_2: "3" }, held)).toBe("differs");
    expect(compareResultRow("trx_battery", { ...performance, nilai_acuan: "ignored" }, held)).toBe("equal");
    const physical = { ...label, status: "1", status_kebersihan: "0" };
    expect(compareResultRow("trx_pemeriksaan_fisik", physical, result({ outcome: "good", cleanliness: "dirty" }))).toBe("equal");
    expect(compareResultRow("trx_pemeriksaan_fisik", { ...physical, status_kebersihan: "1" }, result({ outcome: "good", cleanliness: "clean" }))).toBe("equal");
    expect(compareResultRow("trx_pemeriksaan_fisik", physical, result({ outcome: "good", cleanliness: "clean" }))).toBe("differs");
    expect(compareResultRow("trx_pemeriksaan_fisik", { ...physical, status_kebersihan: "9" }, result({ outcome: "good" }))).toBe("explained");
    expect(compareResultRow("trx_pemeriksaan_fisik", { ...physical, status_kebersihan: "9" }, result({ outcome: "good", cleanliness: "clean" }))).toBe("differs");
    expect(compareResultRow("trx_pemeriksaan_fisik", { ...label, status: "1" }, result({ outcome: "good" }))).toBe("equal");
  });

  it("the rows of a session: equal, quarantined, lost; each landed row against its result", () => {
    const row = { ...label, status: "1" };
    const a = staged("trx_fungsi_alat", row);
    const lost = staged("trx_fungsi_alat", row, null, false);
    const held = staged("trx_fungsi_alat", row, null, true);
    const header = staged("trx_catatan", { description: "x" });
    expect(compareRowCount([a, header], 1)).toBe("equal");
    expect(compareRowCount([a, held], 1)).toBe("explained");
    expect(compareRowCount([a, lost], 1)).toBe("differs");
    expect(compareRowCount([a], 2)).toBe("differs");
    expect(compareValues([], [])).toBe("equal");
    expect(compareValues([a, held, header], [result({ outcome: "pass" })])).toBe("equal");
    expect(compareValues([a], [])).toBe("differs");
    expect(compareValues([staged("trx_fungsi_alat", { description: " Item sintetis", status: "1" })], [result({ outcome: "pass" })])).toBe("explained");
  });
});

describe("P25-03 reportDiff — the visit and the technician", () => {
  const env = (row: Record<string, unknown>): StagedReportRow => staged("trx_kondisi_lingkungan", row);

  it("the visit: the first usable environment visit is the legacy number; 0 or text is none", () => {
    expect(compareVisit([], null)).toBe("equal");
    expect(compareVisit([env({ id: 1, visit: 2 })], 2)).toBe("equal");
    expect(compareVisit([env({ id: 2, visit: 3 }), env({ id: 1, visit: 0 })], 3)).toBe("equal");
    expect(compareVisit([env({ id: 1, visit: 2 })], 3)).toBe("differs");
    expect(compareVisit([env({ id: 1, visit: 0 })], null)).toBe("explained");
    expect(compareVisit([env({ id: 1, visit: 0 })], 1)).toBe("differs");
    expect(compareVisit([env({ id: 1, visit: null })], null)).toBe("equal");
  });

  const users: ReadonlyMap<string, StagedUser> = new Map([
    ["7", { name: "Teknisi  Sintetis", imported: true }],
    ["8", { name: null, imported: true }],
    ["9", { name: "Pergi", imported: false }],
  ]);

  it("the technician: the first environment row's user, a name cleaned, then the key's other rows", () => {
    expect(compareTechnician([env({ id: 1, id_user: 7 })], users, "Teknisi Sintetis")).toBe("explained");
    expect(compareTechnician([env({ id: 1, id_user: 7 })], users, "Orang Lain")).toBe("differs");
    expect(compareTechnician([env({ id: 1, id_user: null }), staged("trx_catatan", { id_user: 7 })], users, "Teknisi Sintetis")).toBe("explained");
  });

  it("no user, a departed user, no name (07 § 3): explained; a former label on an imported account differs", () => {
    expect(compareTechnician([], users, "Upstream import")).toBe("explained");
    expect(compareTechnician([], users, "Orang Lain")).toBe("differs");
    expect(compareTechnician([env({ id: 1, id_user: 9 })], users, "Former upstream user #3")).toBe("explained");
    expect(compareTechnician([env({ id: 1, id_user: 99 })], users, "Former upstream user #4")).toBe("explained");
    expect(compareTechnician([env({ id: 1, id_user: 9 })], users, null)).toBe("differs");
    expect(compareTechnician([env({ id: 1, id_user: 99 })], users, "Pergi")).toBe("differs");
    expect(compareTechnician([env({ id: 1, id_user: 8 })], users, "Unnamed user")).toBe("explained");
    expect(compareTechnician([env({ id: 1, id_user: 7 })], users, "Unnamed user")).toBe("differs");
    expect(compareTechnician([env({ id: 1, id_user: 7 })], users, "Former upstream user #1")).toBe("differs");
  });
});

describe("P25-03 reportDiff — one session and the tally", () => {
  const stored: StoredSession = {
    day: "2025-05-10",
    device: { name: "Pompa", manufacturer: "Merk", model: "Tipe", serialNumber: "SN-1", qrCode: "QR-1" },
    facilityName: "RS Sintetis",
    room: "ICU",
    performerName: "Upstream import",
    legacyVisitNumber: null,
    inspectionOutcome: "pass",
    maintenanceOutcome: "fail",
    recommendation: "needs_repair",
    notes: "Baris satu\nbaris dua",
    results: [],
  };
  const page: ReportCase = {
    day: "2025-05-10",
    device: { nama_alat: "Pompa", merk: "Merk", type: "Tipe", sn: "SN-1", no_qrcode: "QR-1", nama_ruangan: "ICU" },
    facilityName: "RS Sintetis",
    serialShared: false,
    rows: [
      staged("trx_hasil_pemeriksaan", { id: 1, status: "1" }),
      staged("trx_hasil_maintenance", { id: 1, status: "0" }),
      staged("trx_rekomendasi_hasil_pekerjaan", { id: 1, status: "-2" }),
      staged("trx_catatan", { id: 1, description: "Baris satu\nbaris dua" }),
    ],
    users: new Map(),
    stored,
  };
  const worst = (verdicts: Readonly<Record<UpstreamReportDiffField, Verdict>>): Partial<Record<UpstreamReportDiffField, Verdict>> =>
    Object.fromEntries(Object.entries(verdicts).filter(([, v]) => v !== "equal"));

  it("a page that matches is equal in every field but the performer, and a change fails exactly its field", () => {
    expect(worst(compareSession(page))).toEqual({ technician: "explained" });
    expect(worst(compareSession({ ...page, stored: { ...stored, device: { ...stored.device, model: "Lain" } } }))).toEqual({ technician: "explained", "device.model": "differs" });
    expect(worst(compareSession({ ...page, stored: { ...stored, day: "2025-05-11" } }))).toEqual({ technician: "explained", "ipm.date": "differs" });
    expect(worst(compareSession({ ...page, stored: { ...stored, recommendation: "fit_for_use" } }))).toEqual({ technician: "explained", recommendation: "differs" });
  });

  it("the facility and the room fold case, the name does not; a note compares cleaned", () => {
    const verdicts = compareSession({ ...page, facilityName: "rs sintetis", device: { ...page.device, nama_ruangan: "icu", nama_alat: "pompa" } });
    expect(worst(verdicts)).toEqual({ facility: "explained", room: "explained", "device.name": "differs", technician: "explained" });
    const notes = (description: unknown, held: string | null): Verdict =>
      compareSession({ ...page, rows: [staged("trx_catatan", { id: 1, description })], stored: { ...stored, notes: held } }).notes;
    expect(notes("  Baris satu  baris dua ", "Baris satu baris dua")).toBe("explained");
    expect(notes("Lain", "Baris")).toBe("differs");
    expect(compareSession({ ...page, rows: [], stored: { ...stored, notes: null } }).notes).toBe("equal");
  });

  it("no staged device: the device fields read as empty, so what we hold differs", () => {
    const verdicts = compareSession({ ...page, device: null });
    expect(verdicts["device.name"]).toBe("differs");
    expect(verdicts["device.serial"]).toBe("differs");
  });

  it("the tally: counts in print order, a field fails on any difference, the note is fixed text", () => {
    const equal = compareSession(page);
    const fields = tallyFields(UPSTREAM_REPORT_DIFF_FIELDS, [equal, { ...equal, notes: "differs" }, { ...equal, notes: "explained" }]);
    expect(fields.map((f) => f.field)).toEqual([...UPSTREAM_REPORT_DIFF_FIELDS]);
    expect(fields.find((f) => f.field === "notes")).toMatchObject({ status: "fail", compared: 3, equal: 1, explained: 1, differs: 1 });
    expect(fields.find((f) => f.field === "device.name")).toMatchObject({ status: "pass", compared: 3, equal: 3, explained: 0, differs: 0 });
    for (const field of UPSTREAM_REPORT_DIFF_FIELDS) {
      expect(REPORT_DIFF_NOTES[field].length).toBeLessThanOrEqual(280);
    }
  });
});
