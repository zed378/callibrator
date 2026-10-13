/**
 * P24-02g — the transform's IPM steps (services/upstreamImport/transform/ipm.ts, ipmSessions.ts,
 * ipmResults.ts) over a statement double: the registry, the session key, the code maps, one result's
 * values in every section, the session plan (duplicates, header-less keys, the device, the three
 * performers, the visit numbers, the re-runs), the result plan (the definition match, the re-runs),
 * the issue (numbers, hash) and what each step sends. The same statements run on PostgreSQL 18 in
 * migrations/upstreamTransform.p2402g.live, where the application's own `checkIntegrity` recomputes
 * every stored hash.
 *
 * Synthetic values only.
 */
import { createHash } from "crypto";
import type { Transaction } from "sequelize";
import { TRANSFORM_STEPS, isBuilt, type StepContext } from "../../../services/upstreamImport/transform/steps";
import { STAGED_TABLES } from "../../../services/upstreamImport/tablePolicy";
import { STEP_AUDITED } from "../../../services/upstreamImport/transform/auditRows";
import {
  RESULT_SOURCES,
  RESULT_TABLES,
  SESSION_SOURCES,
  byLegacyId,
  codeOf,
  legacyKeyOf,
  noteOf,
  readStagedIpm,
  resultValuesOf,
  resultsFingerprint,
  sessionFingerprint,
  tenantOf,
  type ComparableResult,
  type DefinitionFacts,
  type StagedIpmRow,
} from "../../../services/upstreamImport/transform/ipm";
import { deviceFactsOf, planSessions, runIpmSessions, visitOf, type DeviceFacts, type KeyRow, type SessionInput } from "../../../services/upstreamImport/transform/ipmSessions";
import {
  definitionFor,
  issueReports,
  labelIndex,
  planResults,
  reportPrefixOf,
  runIpmResults,
  type DraftSession,
  type ResultInput,
  type StoredResult,
} from "../../../services/upstreamImport/transform/ipmResults";
import { canonicalIpmReportPayload, type IpmReportResult } from "@callibrator/contracts/ipmReport";
import type { IpmIssuerSnapshot } from "../../../utils/jsonShape.util";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const RUN = "a2402000-0000-4000-8000-0000000000f7";
const TENANT = "a2402000-0000-4000-8000-0000000000a1";
const TX = { id: "tx" } as unknown as Transaction;
const DEVICE = "a2402000-0000-4000-8000-0000000000c1";
const DEVICE_2 = "a2402000-0000-4000-8000-0000000000c3";
const FAC = "a2402000-0000-4000-8000-0000000000c2";
const USER = "a2402000-0000-4000-8000-0000000000d2";
const SESSION = "a2402000-0000-4000-8000-0000000000e1";
const ISSUED = "a2402000-0000-4000-8000-0000000000e2";
const DEF = "a2402000-0000-4000-8000-0000000000b1";
const ZONE = "Asia/Jakarta";

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

const double = (rules: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    query: (text: string, options: SqlQueryOptions) => {
      const call = { text, bind: options.bind ?? [], transaction: options.transaction };
      calls.push(call);
      const rule = rules.find(([pattern]) => pattern.test(text));
      return Promise.resolve(rule ? rule[1](call) : []);
    },
  };
};

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX, tenantId: TENANT, sourceZone: ZONE });

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

/** 2025-05-10 09:00 in Jakarta. */
const AT = "2025-05-10T02:00:00.000Z";

const staged = (legacyId: string, row: Record<string, unknown> = {}, values: Partial<StagedIpmRow> = {}): StagedIpmRow => ({
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "c"),
  targetId: null,
  decision: "new",
  qr: "QR-1",
  performedAt: AT,
  row: { id_user: 7, ...row },
  ...values,
});

const keyRow = (table: string, legacyId: string, values: Partial<KeyRow> = {}): KeyRow => ({ table, legacyId, qr: "QR-1", performedAt: AT, userId: "7", visit: null, ...values });

const facts = (id: string, code: string | null = "F-0001"): DeviceFacts =>
  deviceFactsOf({
    id,
    facilityId: FAC,
    name: "Pompa",
    manufacturer: null,
    model: null,
    serialNumber: null,
    qrCode: "QR",
    deviceTypeId: null,
    deviceTypeName: null,
    lastCalibrationDate: null,
    nextCalibrationDate: null,
    facilityName: "RS",
    facilityCode: code,
    facilityKind: null,
    facilityAddress: null,
    room: "ICU",
    floor: "2",
  });

const definition = (values: Partial<DefinitionFacts> = {}): DefinitionFacts => ({
  id: DEF,
  section: "electrical_safety",
  label: "Arus bocor",
  unit: "µA",
  limitOp: "lte",
  limitValue: "100",
  limitLow: null,
  limitHigh: null,
  limitNominal: null,
  limitTolerance: null,
  settingValue: null,
  ...values,
});

describe("P24-02g the registry", () => {
  it("steps 11 and 12 are built over the sixteen IPM tables, each staged and in exactly one step, and audit themselves", () => {
    const sessions = TRANSFORM_STEPS.find((s) => s.id === "inspection_sessions");
    const results = TRANSFORM_STEPS.find((s) => s.id === "inspection_results");
    expect(sessions?.sources).toBe(SESSION_SOURCES);
    expect(results?.sources).toBe(RESULT_SOURCES);
    expect(sessions?.run).toBe(runIpmSessions);
    expect(results?.run).toBe(runIpmResults);
    const tables = [...SESSION_SOURCES, ...RESULT_SOURCES].map((s) => s.table);
    expect(tables).toHaveLength(16);
    expect(tables.every((t) => STAGED_TABLES.includes(t))).toBe(true);
    expect([...SESSION_SOURCES, ...RESULT_SOURCES].every((s) => s.legacyId === 's."id"::text')).toBe(true);
    expect(STEP_AUDITED.has("inspection_sessions") && STEP_AUDITED.has("inspection_results")).toBe(true);
    // Step 9 (attachments, P24-03) is the last one not built: the transform stays unavailable.
    expect(TRANSFORM_STEPS.filter((s) => !isBuilt([s])).map((s) => s.id)).toEqual(["attachments"]);
  });
});

describe("P24-02g the key, the codes and the fingerprints", () => {
  it("the key is the QR and the day of the instant in the tenant's zone; nothing without both; never longer than 64", () => {
    expect(legacyKeyOf("QR-1", "2025-05-09T17:30:00.000Z", ZONE)).toBe("QR-1|2025-05-10");
    expect(legacyKeyOf("QR-1", "2025-05-09T17:30:00.000Z", "UTC")).toBe("QR-1|2025-05-09");
    expect(legacyKeyOf(null, AT, ZONE)).toBeNull();
    expect(legacyKeyOf("QR-1", null, ZONE)).toBeNull();
    expect(legacyKeyOf("Q".repeat(53), AT, ZONE)).toHaveLength(64);
    expect(legacyKeyOf("Q".repeat(54), AT, ZONE)).toBeNull();
  });

  it("legacy ids in numeric order, ties by the text; a code trimmed; a note cleaned", () => {
    expect([{ legacyId: "10" }, { legacyId: "9" }, { legacyId: "x" }, { legacyId: "a" }].sort(byLegacyId).map((r) => r.legacyId)).toEqual(["9", "10", "a", "x"]);
    expect(codeOf({ status: " -1 " }, "status")).toBe("-1");
    expect(codeOf({ status: 1 }, "status")).toBe("1");
    expect(codeOf({ status: "  " }, "status")).toBeNull();
    expect(codeOf({}, "status")).toBeNull();
    expect(noteOf("  Baris satu\nbaris\u0007 dua  ")).toBe("Baris satu\nbaris  dua");
    expect(noteOf("   ")).toBeNull();
    expect(noteOf(null)).toBeNull();
    expect(noteOf("x".repeat(5000))).toHaveLength(4000);
  });

  it("a visit is a positive smallint, else none", () => {
    expect(visitOf("2")).toBe(2);
    expect(visitOf(" 3 ")).toBe(3);
    expect(visitOf("0")).toBeNull();
    expect(visitOf("40000")).toBeNull();
    expect(visitOf("x")).toBeNull();
    expect(visitOf(null)).toBeNull();
  });

  it("the fingerprints compare values in section and order, never ids", () => {
    const a: ComparableResult = {
      section: "function",
      sortOrder: 2,
      label: "B",
      outcome: "pass",
      cleanliness: null,
      measuredValue: null,
      measuredValue1: null,
      measuredValue2: null,
      rawValue: null,
      setting: null,
      reference: null,
      symbol: null,
    };
    const b = { ...a, section: "environment" as const, sortOrder: 1 };
    const c = { ...a, sortOrder: 1 };
    const withId: ComparableResult & { id: string } = { ...c, id: "x" };
    expect(resultsFingerprint([a, b, c])).toBe(resultsFingerprint([withId, b, a]));
    expect(resultsFingerprint([a])).not.toBe(resultsFingerprint([{ ...a, outcome: "fail" }]));
    const s = { deviceId: DEVICE, performedAt: AT, inspectionOutcome: "pass", maintenanceOutcome: null, recommendation: null, notes: null, legacyVisitNumber: 1 };
    expect(sessionFingerprint(s)).toBe(sessionFingerprint({ ...s }));
    expect(sessionFingerprint(s)).not.toBe(sessionFingerprint({ ...s, legacyVisitNumber: 2 }));
  });
});

describe("P24-02g one result's values", () => {
  const values = (table: string, row: Record<string, unknown>, def: DefinitionFacts | null = null) => resultValuesOf(table, { description: "Butir", ...row }, def);

  it("no label: none", () => {
    expect(resultValuesOf("trx_konsumabel", { description: "  ", status: "1" }, null)).toBeNull();
    expect(resultValuesOf("trx_konsumabel", { status: "1" }, null)).toBeNull();
  });

  it("environment: a decimal comma read; out of its plausible range NULL, raw and flagged; not a number raw; a third reading unchecked", () => {
    expect(values("trx_kondisi_lingkungan", { id_kondisi_lingkungan: 1, value: "25,50" })).toMatchObject({
      section: "environment",
      inputKind: "measured",
      measuredValue: "25.5",
      rawValue: null,
      warnFlag: false,
      outcome: null,
    });
    expect(values("trx_kondisi_lingkungan", { id_kondisi_lingkungan: 2, value: " 150 " })).toMatchObject({ measuredValue: null, rawValue: "150", warnFlag: true });
    expect(values("trx_kondisi_lingkungan", { id_kondisi_lingkungan: 1, value: "-21" })).toMatchObject({ measuredValue: null, warnFlag: true });
    expect(values("trx_kondisi_lingkungan", { id_kondisi_lingkungan: 1, value: "hangat" })).toMatchObject({ measuredValue: null, rawValue: "hangat", warnFlag: false });
    expect(values("trx_kondisi_lingkungan", { id_kondisi_lingkungan: 3, value: "500" })).toMatchObject({ measuredValue: "500", warnFlag: false });
    expect(values("trx_kondisi_lingkungan", { value: "" })).toMatchObject({ measuredValue: null, rawValue: null });
  });

  it("electrical supply and safety: measured, or N/A without a value; safety computed from the definition's limit only", () => {
    expect(values("trx_kondisi_kelistrikan", { status: "1", value: "220" })).toMatchObject({ outcome: null, measuredValue: "220" });
    expect(values("trx_kondisi_kelistrikan", { status: "-1", value: "220" })).toMatchObject({ outcome: "not_applicable", measuredValue: null });
    expect(values("trx_keamanan_listrik", { status: "1", value: "50", symbol: " I " }, definition())).toMatchObject({
      outcome: null,
      computedOutcome: "pass",
      outcomeSource: "computed",
      symbol: "I",
      unit: "µA",
      itemDefinitionId: DEF,
    });
    expect(values("trx_keamanan_listrik", { status: "1", value: "150" }, definition())).toMatchObject({ computedOutcome: "fail" });
    expect(values("trx_keamanan_listrik", { status: "1", value: "50" }, definition({ limitOp: null }))).toMatchObject({ computedOutcome: null, outcomeSource: null });
    expect(values("trx_keamanan_listrik", { status: "1", value: "50" })).toMatchObject({ computedOutcome: null, unit: null, itemDefinitionId: null });
    expect(values("trx_keamanan_listrik", { status: "1", value: "x" }, definition())).toMatchObject({ computedOutcome: null, rawValue: "x" });
    expect(values("trx_keamanan_listrik", { status: "-1" }, definition())).toMatchObject({ outcome: "not_applicable", computedOutcome: null });
  });

  it("the checklists by their section's codes; an unknown code NULL and kept raw", () => {
    expect(values("trx_alat_kerja_digunakan", { status: "0" })).toMatchObject({ section: "tools_used", inputKind: "check", outcome: "not_done" });
    expect(values("trx_pemeriksaan_keamanan_lain", { status: "-1" })).toMatchObject({ outcome: "not_applicable" });
    expect(values("trx_fungsi_alat", { status: "" })).toMatchObject({ outcome: null, rawValue: null });
    expect(values("trx_kelengkapan_alat", { status: "1" })).toMatchObject({ outcome: "pass" });
    expect(values("trx_pemeliharaan_alat", { status: "1" })).toMatchObject({ outcome: "done" });
    expect(values("trx_konsumabel", { status: "0" })).toMatchObject({ outcome: "not_available" });
    expect(values("trx_konsumabel", { status: "5" })).toMatchObject({ outcome: null, rawValue: "5" });
  });

  it("physical: condition and cleanliness each by its own code", () => {
    expect(values("trx_pemeriksaan_fisik", { status: "-1", status_kebersihan: "0" })).toMatchObject({ outcome: "major_damage", cleanliness: "dirty", inputKind: "condition_clean" });
    expect(values("trx_pemeriksaan_fisik", { status: "1", status_kebersihan: "9" })).toMatchObject({ outcome: "good", cleanliness: null, rawValue: "9" });
    expect(values("trx_pemeriksaan_fisik", { status: "1" })).toMatchObject({ cleanliness: null, rawValue: null });
  });

  it("performance and battery: the setting, two readings, the reference; every failed reading kept raw", () => {
    expect(values("trx_kinerja_alat", { status: "1", setting: "60 mL/h", terukur_1: "59.80", terukur_2: "abc", nilai_acuan: "± 10 %" })).toMatchObject({
      section: "performance",
      inputKind: "setting_measured_reference",
      outcome: "pass",
      setting: "60 mL/h",
      measuredValue1: "59.8",
      measuredValue2: null,
      reference: "± 10 %",
      rawValue: "abc",
    });
    expect(values("trx_battery", { status: "0", setting: "12 V", terukur_1: "x", terukur_2: "y", nilai_acuan: "ignored" })).toMatchObject({
      outcome: "fail",
      reference: null,
      rawValue: "x | y",
    });
    expect(values("trx_battery", { status: "1", terukur_1: "z".repeat(300) })?.rawValue).toHaveLength(255);
    expect(values("trx_konsumabel", { status: "1", setting: "x" })).toMatchObject({ setting: null, measuredValue1: null });
  });
});

describe("P24-02g the staged reads", () => {
  it("a staged IPM table: classified, its QR and its instant read in the source zone, every value bound", async () => {
    const runner = double([[/AS row/, () => [staged("1")]]]);
    expect(await readStagedIpm(context(runner), SESSION_SOURCES[0] as (typeof SESSION_SOURCES)[number])).toHaveLength(1);
    expect(runner.calls[0]?.bind).toEqual([RUN, ZONE]);
    expect(runner.calls[0]?.text).toContain('upstream_import."stg_trx_hasil_pemeriksaan"');
  });

  it("the tenant's IPM zone when it is one, else the default; its name", async () => {
    expect(await tenantOf(context(double([[/FROM tenants t/, () => [{ name: "P", zone: "UTC" }]]])))).toEqual({ name: "P", zone: "UTC" });
    expect(await tenantOf(context(double([[/FROM tenants t/, () => [{ name: "P", zone: "Mars/Base" }]]])))).toEqual({ name: "P", zone: ZONE });
    const runner = double();
    expect(await tenantOf(context(runner))).toEqual({ name: null, zone: ZONE });
    expect(runner.calls[0]?.bind).toEqual([TENANT, "tenant_time_zone"]);
  });
});

// ------------------------------------------------------------------
// STEP 11
// ------------------------------------------------------------------

const sessionInput = (rows: Partial<SessionInput["rows"]>, extra: Partial<SessionInput> = {}): SessionInput => ({
  tenantId: TENANT,
  tenantName: "Penyedia",
  zone: ZONE,
  rows: { trx_hasil_pemeriksaan: [], trx_hasil_maintenance: [], trx_rekomendasi_hasil_pekerjaan: [], trx_catatan: [], ...rows },
  keyRows: [],
  devices: new Map([
    ["QR-1", facts(DEVICE)],
    ["QR-2", facts(DEVICE_2)],
  ]),
  existing: new Map(),
  lastVisit: new Map([[DEVICE, 3]]),
  users: new Map([["7", { id: USER, snapshot: { name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia" } }]]),
  unmatched: new Set(["8"]),
  formerUsers: new Map([["50", 2]]),
  newId: ids(),
  ...extra,
});

describe("P24-02g the session plan", () => {
  it("one session per key: the highest header wins, the others duplicate; the header's values, the note, the visit kept; the person performs", () => {
    const plan = planSessions(
      sessionInput(
        {
          trx_hasil_pemeriksaan: [staged("1", { status: "1" }), staged("2", { status: "0" })],
          trx_hasil_maintenance: [staged("1", { status: "1" })],
          trx_rekomendasi_hasil_pekerjaan: [staged("1", { status: "-2" })],
          trx_catatan: [staged("1", { description: " Catatan " })],
        },
        { keyRows: [keyRow("trx_kondisi_lingkungan", "5", { visit: "x" }), keyRow("trx_kondisi_lingkungan", "6", { visit: "2" })] },
      ),
    );
    expect(plan.quarantine).toEqual([{ sourceTable: "trx_hasil_pemeriksaan", sourceRowNumber: "101", legacyId: "1", reason: "duplicate_header" }]);
    expect(plan.insert).toEqual([
      {
        id: "a2402000-0000-4000-8000-000000000001",
        legacyKey: "QR-1|2025-05-10",
        deviceId: DEVICE,
        facilityId: FAC,
        performedAt: AT,
        performedBy: USER,
        performerSnapshot: { name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia" },
        deviceSnapshot: facts(DEVICE).device,
        facilitySnapshot: { id: FAC, name: "RS", code: "F-0001", kind: null, address: null },
        room: "ICU",
        floor: "2",
        visitNumber: 4,
        legacyVisitNumber: 2,
        inspectionOutcome: "fail",
        maintenanceOutcome: "pass",
        recommendation: "needs_repair",
        notes: "Catatan",
      },
    ]);
    expect(plan.mappings.map((m) => [m.sourceTable, m.legacyId, m.targetTable, m.targetId, m.clientFacilityId])).toEqual([
      ["trx_hasil_pemeriksaan", "2", "inspection_sessions", "a2402000-0000-4000-8000-000000000001", FAC],
      ["trx_hasil_maintenance", "1", "inspection_sessions", "a2402000-0000-4000-8000-000000000001", FAC],
      ["trx_rekomendasi_hasil_pekerjaan", "1", "inspection_sessions", "a2402000-0000-4000-8000-000000000001", FAC],
      ["trx_catatan", "1", "inspection_sessions", "a2402000-0000-4000-8000-000000000001", FAC],
    ]);
  });

  it("header-less keys; the performer from the environment, else the header, else any row; former and unknown performers; visits per device in time order", () => {
    const later = "2025-06-10T03:00:00.000Z";
    const plan = planSessions(
      sessionInput(
        {
          trx_hasil_pemeriksaan: [staged("3", { status: "1", id_user: null }, { qr: "QR-2" }), staged("4", { status: "1", id_user: 51 }, { qr: "QR-2", performedAt: later })],
        },
        {
          keyRows: [
            // Key QR-1|06-10: header-less, the departed user 99 from a result row.
            keyRow("trx_konsumabel", "9", { userId: "99", performedAt: later }),
            keyRow("trx_konsumabel", "8", { userId: null, performedAt: "2025-06-10T02:00:00.000Z" }),
            // Key QR-1|05-10: the environment's user wins over the header's.
            keyRow("trx_kondisi_lingkungan", "1", { userId: null }),
            keyRow("trx_kondisi_lingkungan", "2", { userId: "7" }),
            keyRow("trx_fungsi_alat", "1", { qr: null }),
          ],
          lastVisit: new Map(),
        },
      ),
    );
    expect(plan.insert.map((s) => [s.legacyKey, s.performedAt, s.performedBy, s.performerSnapshot.name, s.visitNumber, s.inspectionOutcome])).toEqual([
      ["QR-1|2025-05-10", AT, USER, "Teknisi", 1, null],
      ["QR-2|2025-05-10", AT, null, "Upstream import", 1, "pass"],
      ["QR-1|2025-06-10", "2025-06-10T02:00:00.000Z", null, "Former upstream user #4", 2, null],
      ["QR-2|2025-06-10", later, null, "Former upstream user #3", 2, "pass"],
    ]);
    expect(plan.insert[1]?.performerSnapshot).toEqual({ name: "Upstream import", role: "import", organisation: "Penyedia" });
    // Numbered after the highest given (#2), in upstream id order: 51 → #3, 99 → #4.
    expect(plan.formerUsers).toEqual([
      { legacyId: "51", number: 3 },
      { legacyId: "99", number: 4 },
    ]);
  });

  it("quarantine: no key, no device, a performer the tenant no longer has, an unknown code (the session still made)", () => {
    const plan = planSessions(
      sessionInput({
        trx_hasil_pemeriksaan: [staged("1", { status: "1" }, { performedAt: null }), staged("2", { status: "1" }, { qr: "QR-9" }), staged("3", { status: "1", id_user: 8 }, { qr: "QR-2" })],
        trx_hasil_maintenance: [staged("4", { status: "x" })],
        trx_rekomendasi_hasil_pekerjaan: [staged("5", { status: "9" }), staged("6", {}, { qr: "QR-2" })],
      }),
    );
    expect(plan.quarantine.map((q) => [q.sourceTable, q.legacyId, q.reason])).toEqual([
      ["trx_hasil_pemeriksaan", "1", "value_out_of_range"],
      ["trx_hasil_maintenance", "4", "value_out_of_range"],
      ["trx_rekomendasi_hasil_pekerjaan", "5", "value_out_of_range"],
      ["trx_hasil_pemeriksaan", "3", "performer_not_found"],
      ["trx_rekomendasi_hasil_pekerjaan", "6", "performer_not_found"],
      ["trx_hasil_pemeriksaan", "2", "no_device"],
    ]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.insert[0]).toMatchObject({ legacyKey: "QR-1|2025-05-10", maintenanceOutcome: null, recommendation: null, inspectionOutcome: null });
    expect(plan.mappings).toEqual([]);
  });

  it("re-runs: an unchanged key maps only its new or moved rows onto the session; a changed one is quarantined whole", () => {
    const existing = {
      id: SESSION,
      facilityId: FAC,
      deviceId: DEVICE,
      performedAt: AT,
      inspectionOutcome: "pass",
      maintenanceOutcome: null,
      recommendation: null,
      notes: null,
      legacyVisitNumber: null,
    };
    const rows = {
      trx_hasil_pemeriksaan: [staged("1", { status: "1" }, { decision: "unchanged", targetId: SESSION }), staged("2", { status: "1" }, { qr: "QR-2" })],
      trx_catatan: [staged("3", { description: "" }, { decision: "unchanged", targetId: "elsewhere" })],
    };
    const same = planSessions(sessionInput(rows, { existing: new Map([["QR-1|2025-05-10", existing], ["QR-2|2025-05-10", { ...existing, id: ISSUED, deviceId: DEVICE_2 }]]) }));
    expect(same.insert).toEqual([]);
    expect(same.mappings.map((m) => [m.sourceTable, m.legacyId, m.targetId])).toEqual([
      ["trx_catatan", "3", SESSION],
      ["trx_hasil_pemeriksaan", "2", ISSUED],
    ]);
    const changed = planSessions(sessionInput(rows, { existing: new Map([["QR-1|2025-05-10", { ...existing, inspectionOutcome: "fail" }]]) }));
    expect(changed.quarantine.filter((q) => q.reason === "session_changed_upstream").map((q) => q.legacyId)).toEqual(["1", "3"]);
    expect(changed.insert.map((s) => s.legacyKey)).toEqual(["QR-2|2025-05-10"]);
  });
});

describe("P24-02g the sessions step", () => {
  const device = {
    id: DEVICE,
    facilityId: FAC,
    name: "Pompa",
    manufacturer: "M",
    model: "X",
    serialNumber: "SN",
    qrCode: "QR-1",
    deviceTypeId: null,
    deviceTypeName: null,
    lastCalibrationDate: "2025-03-31",
    nextCalibrationDate: null,
    facilityName: "RS",
    facilityCode: "F-0001",
    facilityKind: "hospital",
    facilityAddress: null,
    room: "ICU",
    floor: "2",
  };
  const world = (extra: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } =>
    double([
      ...extra,
      [/to_regclass/, (c) => [{ present: !String(c.bind[0]).includes("trx_battery") }]],
      [/AS row/, (c) => (c.text.includes("stg_trx_hasil_pemeriksaan") ? [staged("1", { status: "1", id_user: 99 })] : [])],
      [/AS "userId"/, (c) => (c.text.includes("stg_trx_konsumabel") ? [{ legacyId: "4", qr: "QR-1", performedAt: AT, userId: "7", visit: null }] : [])],
      [/FROM tenants t/, () => [{ name: "Penyedia", zone: null }]],
      [/stg_trx_inventory/, () => [{ qr: "QR-1", legacyId: "101" }, { qr: "QR-3", legacyId: "103" }]],
      [/source_table = \$1 AND legacy_id/, (c) => (c.bind[0] === "trx_inventory" ? [{ legacyId: "101", targetId: DEVICE }] : [{ legacyId: "7", targetId: USER }])],
      [/FROM calibration_devices d/, () => [device]],
      [/FROM users u/, () => [{ id: USER, firstName: "Teknisi", lastName: null, role: "TECHNICIAN", organisation: "RS" }]],
      [/legacy_key = ANY/, () => [{ id: SESSION, legacyKey: "QR-1|2025-06-10", facilityId: FAC, deviceId: DEVICE, performedAt: AT }]],
      [/max\(visit_number\)/, () => [{ deviceId: DEVICE, visit: 1 }]],
      [/SELECT legacy_user_id/, () => [{ legacyId: "50", number: 1 }]],
    ]);

  it("nothing staged: only the table checks", async () => {
    const runner = double();
    await runIpmSessions(context(runner));
    expect(runner.calls.every((c) => c.text.includes("to_regclass"))).toBe(true);
    expect(runner.calls).toHaveLength(16);
  });

  it("reads in the provider tenant, inserts the drafts with every value bound, numbers the former user, maps the header", async () => {
    const runner = world();
    await runIpmSessions(context(runner));
    expect(runner.calls.filter((c) => c.text.includes('AS "userId"'))).toHaveLength(11);
    expect(runner.calls.find((c) => c.text.includes("FROM calibration_devices d"))?.bind).toEqual([TENANT, [DEVICE]]);
    expect(runner.calls.find((c) => c.text.includes("legacy_key = ANY"))?.bind).toEqual([TENANT, ["QR-1|2025-05-10"]]);
    expect(runner.calls.find((c) => c.text.includes("max(visit_number)"))?.bind).toEqual([TENANT, [DEVICE]]);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.former_users"))?.bind).toEqual([RUN, ["99"], [2]]);
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO inspection_sessions"));
    expect(insert?.text).toContain("'draft'");
    expect(insert?.bind[0]).toBe(TENANT);
    expect(insert?.bind.slice(2, 6)).toEqual([[FAC], [DEVICE], [AT], [null]]);
    expect(JSON.parse((insert?.bind[6] as string[])[0] as string)).toEqual({ name: "Former upstream user #2", role: null, organisation: null });
    expect(JSON.parse((insert?.bind[7] as string[])[0] as string)).toMatchObject({ name: "Pompa", lastCalibrationDate: "2025-03-31" });
    expect(JSON.parse((insert?.bind[8] as string[])[0] as string)).toEqual({ id: FAC, name: "RS", code: "F-0001", kind: "hospital", address: null });
    expect(insert?.bind.slice(9, 18)).toEqual([["ICU"], ["2"], [2], [null], ["pass"], [null], [null], [null], ["QR-1|2025-05-10"]]);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.id_map"))?.bind.slice(0, 4)).toEqual(["trx_hasil_pemeriksaan", "1", "inspection_sessions", insert?.bind[1] && (insert.bind[1] as string[])[0]]);
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("no inventory staged: every key without a device; no insert", async () => {
    const runner = world([[/to_regclass/, (c) => [{ present: !String(c.bind[0]).includes("trx_inventory") }]]]);
    await runIpmSessions(context(runner));
    expect(runner.calls.some((c) => c.text.startsWith("INSERT INTO inspection_sessions"))).toBe(false);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.quarantine"))?.bind).toContain("no_device");
  });
});

// ------------------------------------------------------------------
// STEP 12
// ------------------------------------------------------------------

const resultInput = (rows: ResultInput["rows"], extra: Partial<ResultInput> = {}): ResultInput => ({
  tenantId: TENANT,
  zone: ZONE,
  rows,
  sessions: new Map([
    ["QR-1|2025-05-10", { id: SESSION, facilityId: FAC, draft: true }],
    ["QR-2|2025-05-10", { id: ISSUED, facilityId: FAC, draft: false }],
  ]),
  stored: new Map(),
  itemTargets: new Map([["mst_pemeriksaan_keamanan_listrik#1", DEF]]),
  definitions: new Map([[DEF, definition()]]),
  newId: ids(),
  ...extra,
});

describe("P24-02g the definition match", () => {
  const rule = RESULT_TABLES["trx_keamanan_listrik"] as (typeof RESULT_TABLES)[string];
  const env = RESULT_TABLES["trx_konsumabel"] as (typeof RESULT_TABLES)[string];
  const defs = new Map([
    [DEF, definition()],
    ["d2", definition({ id: "d2", section: "function", label: "Nyala" })],
    ["d3", definition({ id: "d3", section: "consumable", label: "Kertas" })],
    ["d4", definition({ id: "d4", section: "consumable", label: "kertas" })],
    ["d5", definition({ id: "d5", section: "consumable", label: "Tinta" })],
  ]);
  const index = labelIndex(defs);

  it("by the upstream item id; else the section's one definition of that label; a shared label or another section matches none", () => {
    const targets = new Map([
      ["mst_pemeriksaan_keamanan_listrik#1", DEF],
      ["mst_pemeriksaan_keamanan_listrik#2", "d2"],
    ]);
    expect(definitionFor(rule, { id_keamanan_listrik: 1 }, "Apa saja", targets, defs, index)?.id).toBe(DEF);
    expect(definitionFor(rule, { id_keamanan_listrik: 2 }, "Apa saja", targets, defs, index)).toBeNull();
    expect(definitionFor(rule, { id_keamanan_listrik: 3 }, "ARUS BOCOR", targets, defs, index)?.id).toBe(DEF);
    expect(definitionFor(rule, { id_keamanan_listrik: 4 }, "x", new Map([["mst_pemeriksaan_keamanan_listrik#4", "gone"]]), defs, index)).toBeNull();
    expect(definitionFor(rule, {}, "x", targets, defs, index)).toBeNull();
    expect(definitionFor(env, {}, "TINTA", targets, defs, index)?.id).toBe("d5");
    expect(definitionFor(env, {}, "Kertas", targets, defs, index)).toBeNull();
  });
});

describe("P24-02g the result plan", () => {
  it("rows of a draft are inserted in upstream order within their section, each mapped; the quarantine reasons", () => {
    const plan = planResults(
      resultInput({
        trx_keamanan_listrik: [
          staged("2", { description: "Kedua", status: "-1", id_keamanan_listrik: 0 }),
          staged("1", { description: "Arus", status: "1", value: "50", id_keamanan_listrik: 1 }),
          staged("3", { description: "Tanpa sesi" }, { qr: "QR-9" }),
          staged("4", { description: "Tanpa waktu" }, { performedAt: null }),
          staged("5", { description: " " }),
        ],
        trx_konsumabel: [staged("x1", { description: "Kertas", status: "1" })],
        trx_fungsi_alat: [staged("7", { description: "Nyala", status: "1" })],
      }),
    );
    expect(plan.quarantine.map((q) => [q.sourceTable, q.legacyId, q.reason])).toEqual([
      ["trx_keamanan_listrik", "3", "session_not_imported"],
      ["trx_keamanan_listrik", "4", "value_out_of_range"],
      ["trx_keamanan_listrik", "5", "value_out_of_range"],
      ["trx_konsumabel", "x1", "value_out_of_range"],
    ]);
    expect(plan.insert.map((r) => [r.legacyTable, r.legacyId, r.section, r.sortOrder, r.sessionId, r.itemDefinitionId, r.computedOutcome])).toEqual([
      ["trx_fungsi_alat", 7, "function", 1, SESSION, null, null],
      ["trx_keamanan_listrik", 1, "electrical_safety", 1, SESSION, DEF, "pass"],
      ["trx_keamanan_listrik", 2, "electrical_safety", 2, SESSION, null, null],
    ]);
    expect(plan.mappings.map((m) => [m.sourceTable, m.legacyId, m.targetTable, m.clientFacilityId])).toEqual([
      ["trx_fungsi_alat", "7", "inspection_results", FAC],
      ["trx_keamanan_listrik", "1", "inspection_results", FAC],
      ["trx_keamanan_listrik", "2", "inspection_results", FAC],
    ]);
  });

  it("re-runs on an issued session: unchanged rows mapped onto the stored results (only new or moved ones); a changed one quarantines the key's rows", () => {
    const stored: StoredResult[] = [
      { id: "r1", section: "function", sortOrder: 1, label: "Nyala", outcome: "pass", cleanliness: null, measuredValue: null, measuredValue1: null, measuredValue2: null, rawValue: null, setting: null, reference: null, symbol: null },
      { id: "r2", section: "function", sortOrder: 2, label: "Mati", outcome: "fail", cleanliness: null, measuredValue: null, measuredValue1: null, measuredValue2: null, rawValue: null, setting: null, reference: null, symbol: null },
    ];
    const rows = {
      trx_fungsi_alat: [
        staged("1", { description: "Nyala", status: "1" }, { qr: "QR-2", decision: "unchanged", targetId: "r1" }),
        staged("12", { description: "Mati", status: "0" }, { qr: "QR-2", decision: "unchanged", targetId: "old" }),
      ],
    };
    const same = planResults(resultInput(rows, { stored: new Map([[ISSUED, stored]]) }));
    expect(same.insert).toEqual([]);
    expect(same.mappings.map((m) => [m.legacyId, m.targetId])).toEqual([["12", "r2"]]);
    const changed = planResults(resultInput(rows, { stored: new Map([[ISSUED, stored.slice(0, 1)]]) }));
    expect(changed.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([
      ["1", "session_changed_upstream"],
      ["12", "session_changed_upstream"],
    ]);
    expect(planResults(resultInput(rows)).quarantine).toHaveLength(2);
  });
});

describe("P24-02g the issue", () => {
  const issuer: IpmIssuerSnapshot = {
    version: 1,
    name: "Penyedia",
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    country: null,
    website: null,
    timeZone: ZONE,
  };
  const draft = (id: string, performedAt: string, legacyKey: string, code: string | null = "F-0001"): DraftSession => ({
    id,
    facilityId: FAC,
    legacyKey,
    performedAt,
    performerSnapshot: { name: "Teknisi", role: null, organisation: null },
    deviceSnapshot: facts(DEVICE).device,
    facilitySnapshot: { id: FAC, name: "RS", code, kind: null, address: null },
    room: null,
    floor: null,
    visitNumber: 1,
    legacyVisitNumber: null,
    inspectionOutcome: "pass",
    maintenanceOutcome: null,
    recommendation: null,
    notes: null,
  });

  it("the prefix: the facility code (else SELF) and the day in the zone", () => {
    expect(reportPrefixOf(draft("a", "2025-05-09T17:30:00.000Z", "k"), ZONE)).toEqual({ code: "F-0001", day: "20250510", prefix: "IPM-F-0001-20250510-" });
    expect(reportPrefixOf(draft("a", AT, "k", null), "UTC").prefix).toBe("IPM-SELF-20250510-");
  });

  it("numbers per prefix after the highest taken, in time order; the hash of scheme ipm-report-v1 over the imported payload", () => {
    const result: IpmReportResult = {
      section: "function",
      inputKind: "tri_state",
      label: "Nyala",
      templateItemId: null,
      adHoc: false,
      unit: null,
      symbol: null,
      setting: null,
      reference: null,
      limitText: null,
      outcome: "pass",
      cleanliness: null,
      measuredValue: null,
      measuredValue1: null,
      measuredValue2: null,
      textValue: null,
      rawValue: null,
      computedOutcome: null,
      outcomeSource: null,
      warnFlag: false,
      disagreementFlag: false,
      sortOrder: 1,
      id: "r1",
    };
    let token = 0;
    const reports = issueReports(
      [draft(ISSUED, "2025-05-10T05:00:00.000Z", "B"), draft(SESSION, AT, "A"), draft("c", AT, "C", "F-0002")],
      new Map([[SESSION, [result]]]),
      ["IPM-F-0001-20250510-002", "IPM-F-0001-20250510-x", "IPM-F-0009-20250510-007"],
      issuer,
      () => `t${String((token += 1))}`,
    );
    expect(reports.map((r) => [r.id, r.reportNumber, r.token, r.resultCount])).toEqual([
      [SESSION, "IPM-F-0001-20250510-003", "t1", 1],
      ["c", "IPM-F-0002-20250510-001", "t2", 0],
      [ISSUED, "IPM-F-0001-20250510-004", "t3", 0],
    ]);
    const expected = createHash("sha256")
      .update(
        canonicalIpmReportPayload({
          reportNumber: "IPM-F-0001-20250510-003",
          sessionId: SESSION,
          supersedesReportNumber: null,
          issuer: { name: "Penyedia", email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null },
          facility: { id: FAC, name: "RS", code: "F-0001", kind: null, address: null },
          device: facts(DEVICE).device,
          room: null,
          floor: null,
          visitNumber: 1,
          legacyVisitNumber: null,
          performedAt: AT,
          submittedAt: AT,
          timeZone: ZONE,
          checklist: { imported: true },
          results: [result],
          inspectionOutcome: "pass",
          maintenanceOutcome: null,
          recommendation: null,
          notes: null,
          performer: { name: "Teknisi", role: null, organisation: null },
          capturedOffline: false,
          imported: true,
        }),
        "utf8",
      )
      .digest("hex");
    expect(reports[0]?.hash).toBe(expected);
  });
});

describe("P24-02g the results step", () => {
  const draftRow = {
    id: SESSION,
    facilityId: FAC,
    legacyKey: "QR-1|2025-05-10",
    performedAt: AT,
    performerSnapshot: { name: "Teknisi", role: null, organisation: null },
    deviceSnapshot: facts(DEVICE).device,
    facilitySnapshot: { id: FAC, name: "RS", code: "F-0001", kind: null, address: null },
    room: null,
    floor: null,
    visitNumber: 1,
    legacyVisitNumber: null,
    inspectionOutcome: null,
    maintenanceOutcome: null,
    recommendation: null,
    notes: null,
  };
  const storedRow = {
    sessionId: SESSION,
    id: "r1",
    section: "function",
    sortOrder: 1,
    label: "Nyala",
    outcome: "pass",
    inputKind: "tri_state",
    cleanliness: null,
    measuredValue: null,
    measuredValue1: null,
    measuredValue2: null,
    rawValue: null,
    setting: null,
    reference: null,
    symbol: null,
  };
  const world = (extra: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } =>
    double([
      ...extra,
      [/FROM tenants t/, () => [{ name: "Penyedia", zone: "UTC" }]],
      [/to_regclass/, (c) => [{ present: !String(c.bind[0]).includes("trx_battery") }]],
      [
        /AS row/,
        (c) =>
          c.text.includes("stg_trx_keamanan_listrik")
            ? [staged("1", { description: "Arus", status: "1", value: "50", id_keamanan_listrik: 1 }), staged("2", { description: "Tanpa", id_keamanan_listrik: null })]
            : c.text.includes("stg_trx_fungsi_alat")
              ? [staged("3", { description: "Nyala", status: "1" }, { qr: "QR-2" })]
              : [],
      ],
      [/status = 'draft' AS draft/, () => [{ id: SESSION, legacyKey: "QR-1|2025-05-10", facilityId: FAC, draft: true }, { id: ISSUED, legacyKey: "QR-2|2025-05-10", facilityId: FAC, draft: false }]],
      [/FROM inspection_results r/, (c) => ((c.bind[1] as string[]).includes(ISSUED) ? [{ ...storedRow, sessionId: ISSUED }] : [storedRow, { ...storedRow, id: "r2", sortOrder: 2 }])],
      [/source_table = \$1 AND legacy_id/, () => [{ legacyId: "1", targetId: DEF }]],
      [/FROM inspection_item_definitions/, () => [definition()]],
      [/status = 'draft' AND legacy_key IS NOT NULL/, () => [draftRow]],
      [/starts_with/, () => [{ reportNumber: "IPM-F-0001-20250510-001" }]],
      [/FROM tenants WHERE id/, () => [{ name: "Penyedia", email: "p@example.test", phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null }]],
    ]);

  it("inserts the draft's results, maps the issued session's, issues every draft with its number, token and hash, audits both — every value bound", async () => {
    const runner = world();
    await runIpmResults(context(runner));
    expect(runner.calls.find((c) => c.text.includes("status = 'draft' AS draft"))?.bind).toEqual([TENANT, ["QR-2|2025-05-10", "QR-1|2025-05-10"]]);
    expect(runner.calls.find((c) => c.text.includes("source_table = $1 AND legacy_id"))?.bind).toEqual(["mst_pemeriksaan_keamanan_listrik", ["1"], TENANT]);
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO inspection_results"));
    expect(insert?.bind[0]).toBe(TENANT);
    expect(insert?.bind[3]).toEqual([SESSION, SESSION]);
    expect(insert?.bind[6]).toEqual([DEF, null]);
    expect(insert?.bind[18]).toEqual(["pass", null]);
    expect(insert?.bind.slice(21)).toEqual([[1, 2], ["trx_keamanan_listrik", "trx_keamanan_listrik"], [1, 2]]);
    const map = runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.id_map"));
    expect(map?.bind.filter((b) => b === "inspection_results")).toHaveLength(3);
    expect(map?.bind).toContain("r1");
    const update = runner.calls.find((c) => c.text.startsWith("UPDATE inspection_sessions"));
    expect(update?.bind.slice(0, 2)).toEqual([TENANT, "ipm-report-v1"]);
    expect(JSON.parse(update?.bind[2] as string)).toMatchObject({ version: 1, email: "p@example.test", timeZone: "UTC" });
    expect(update?.bind.slice(3, 5)).toEqual([[SESSION], ["IPM-F-0001-20250510-002"]]);
    expect((update?.bind[5] as string[])[0]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((update?.bind[6] as string[])[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(runner.calls.find((c) => c.text.includes("starts_with"))?.bind).toEqual([TENANT, ["IPM-F-0001-20250510-"]]);
    const audits = runner.calls.filter((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audits.map((a) => a.bind.slice(0, 5))).toEqual([
      [TENANT, "system:upstream-transform", "InspectionResult", RUN, "inspection_results"],
      [TENANT, "system:upstream-transform", "InspectionSession", RUN, "inspection_sessions"],
    ]);
    expect(JSON.parse((audits[1]?.bind[7] as string[])[0] as string)).toMatchObject({ reportNumber: "IPM-F-0001-20250510-002", hashScheme: "ipm-report-v1", resultCount: 2 });
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("nothing staged and no draft: no write; a tenant row missing leaves the issuer empty", async () => {
    const empty = double([[/to_regclass/, () => [{ present: false }]]]);
    await runIpmResults(context(empty));
    expect(empty.calls.some((c) => /^(INSERT|UPDATE)/.test(c.text))).toBe(false);
    const bare = double([
      [/status = 'draft' AND legacy_key IS NOT NULL/, () => [draftRow]],
      [/FROM inspection_results r/, () => []],
    ]);
    await runIpmResults(context(bare));
    const update = bare.calls.find((c) => c.text.startsWith("UPDATE inspection_sessions"));
    expect(JSON.parse(update?.bind[2] as string)).toEqual({
      version: 1,
      name: null,
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
      zipCode: null,
      country: null,
      website: null,
      timeZone: ZONE,
    });
    expect(bare.calls.some((c) => c.text.startsWith("INSERT INTO inspection_results"))).toBe(false);
  });
});
