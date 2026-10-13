/**
 * P24-02f — the transform's calibrations step (services/upstreamImport/transform/calibrations.ts)
 * over a statement double: the calendar day, the plan in every branch (the three performers and the
 * key, the corrections, the four quarantine reasons, the key that is missing), and what the step
 * sends. The same statements run on PostgreSQL 18 in migrations/upstreamTransform.p2402f.live.
 *
 * Synthetic values only.
 */
import type { Transaction } from "sequelize";
import { TRANSFORM_STEPS, type StepContext } from "../../../services/upstreamImport/transform/steps";
import {
  CALIBRATION_SOURCE,
  IMPORT_CORRECTION_REASON,
  calendarDayOf,
  planCalibrations,
  runCalibrations,
  type CalibrationInput,
  type StagedCalibrationRow,
} from "../../../services/upstreamImport/transform/calibrations";
import { STEP_AUDITED } from "../../../services/upstreamImport/transform/auditRows";
import { TransformFailure } from "../../../services/upstreamImport/transform/failure";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const RUN = "a2402000-0000-4000-8000-0000000000f6";
const TENANT = "a2402000-0000-4000-8000-0000000000a1";
const TX = { id: "tx" } as unknown as Transaction;
const DEVICE = "a2402000-0000-4000-8000-0000000000c1";
const FAC = "a2402000-0000-4000-8000-0000000000c2";
const USER = "a2402000-0000-4000-8000-0000000000d2";
const KEY = "a2402000-0000-4000-8000-0000000000d3";
const OLD = "a2402000-0000-4000-8000-0000000000d4";

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

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX, tenantId: TENANT, sourceZone: "Asia/Jakarta" });

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

const calibration = (legacyId: string, row: Record<string, unknown>, values: Partial<StagedCalibrationRow> = {}): StagedCalibrationRow => ({
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "c"),
  targetId: null,
  decision: "new",
  targetPresent: false,
  targetClosed: false,
  row: { id_inventory: 101, tanggal_kalibrasi: "2025-04-01", ...row },
  ...values,
});

const input = (rows: StagedCalibrationRow[], extra: Partial<CalibrationInput> = {}): CalibrationInput => ({
  rows,
  tenantId: TENANT,
  tenantName: "Penyedia",
  today: "2026-10-13",
  devices: new Map([["101", { id: DEVICE, facilityId: FAC }]]),
  users: new Map([["7", { id: USER, snapshot: { name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia" } }]]),
  unmatched: new Set(["8"]),
  formerUsers: new Map([["50", 2]]),
  keyId: KEY,
  newId: ids(),
  ...extra,
});

describe("P24-02f the registry", () => {
  it("step 10 is built over trx_kalibrasi and audits itself", () => {
    expect(TRANSFORM_STEPS.find((s) => s.id === "calibration_records")).toMatchObject({ run: runCalibrations, sources: [CALIBRATION_SOURCE] });
    expect(CALIBRATION_SOURCE).toEqual({ table: "trx_kalibrasi", legacyId: 's."id"::text' });
    expect(STEP_AUDITED.has("calibration_records")).toBe(true);
  });

  it("a calendar day: a real day (a timestamp keeps its day), anything else none", () => {
    expect(calendarDayOf("2025-04-01")).toBe("2025-04-01");
    expect(calendarDayOf("2025-04-01T10:00:00")).toBe("2025-04-01");
    expect(calendarDayOf("1985-01-01")).toBe("1985-01-01");
    expect(calendarDayOf("2025-02-30")).toBeNull();
    expect(calendarDayOf("01/04/2025")).toBeNull();
    expect(calendarDayOf(null)).toBeNull();
  });
});

describe("P24-02f the plan", () => {
  it("the person, a former user (numbered after the last) and the import: the actor and the snapshot of each", () => {
    const plan = planCalibrations(
      input([
        calibration("1", { id_user: 7, nama_ruangan: "  ICU " }),
        calibration("2", { id_user: 99 }),
        calibration("3", { id_user: 50 }),
        calibration("4", {}),
      ]),
    );
    expect(plan.insert.map((r) => [r.performedBy, r.apiKeyId, r.performerSnapshot, r.roomSnapshot, r.supersedesId])).toEqual([
      [USER, null, { name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia", source: "upstream-import" }, "ICU", null],
      [null, KEY, { name: "Former upstream user #3", role: null, organisation: null, source: "upstream-import" }, null, null],
      [null, KEY, { name: "Former upstream user #2", role: null, organisation: null, source: "upstream-import" }, null, null],
      [null, KEY, { name: "Upstream import", role: "import", organisation: "Penyedia", source: "upstream-import" }, null, null],
    ]);
    expect(plan.formerUsers).toEqual([{ legacyId: "99", number: 3 }]);
    expect(plan.insert[0]).toMatchObject({ deviceId: DEVICE, facilityId: FAC, calibrationDate: "2025-04-01", sourceRowNumber: "101" });
    expect(plan.mappings[0]).toEqual({
      sourceTable: "trx_kalibrasi", legacyId: "1", targetTable: "calibration_records", targetId: "a2402000-0000-4000-8000-000000000001",
      tenantId: TENANT, clientFacilityId: FAC, rowHash: "1".padStart(64, "c"), sourceValues: null,
    });
    expect(plan.needsKey).toBe(0);
  });

  it("quarantine: no device, not a day, a future day, a performer the tenant no longer has", () => {
    const plan = planCalibrations(
      input([
        calibration("1", { id_inventory: 999 }),
        calibration("2", { id_inventory: null }),
        calibration("3", { tanggal_kalibrasi: "bad" }),
        calibration("4", { tanggal_kalibrasi: "2026-10-14" }),
        calibration("5", { id_user: 8 }),
        calibration("6", { tanggal_kalibrasi: "2026-10-13" }),
      ]),
    );
    expect(plan.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([
      ["1", "no_device"],
      ["2", "no_device"],
      ["3", "value_out_of_range"],
      ["4", "future_calibration_date"],
      ["5", "performer_not_found"],
    ]);
    expect(plan.insert.map((r) => r.calibrationDate)).toEqual(["2026-10-13"]);
    expect(plan.formerUsers).toEqual([]);
  });

  it("re-runs: unchanged and closed records skipped; a changed one corrected; a vanished target recorded afresh", () => {
    const plan = planCalibrations(
      input([
        calibration("1", { id_user: 7 }, { targetId: "r-1", targetPresent: true, decision: "unchanged" }),
        calibration("2", { id_user: 7 }, { targetId: "r-2", targetPresent: true, decision: "changed", targetClosed: true }),
        calibration("3", { id_user: 7 }, { targetId: OLD, targetPresent: true, decision: "changed" }),
        calibration("4", { id_user: 7 }, { targetId: "r-gone", decision: "changed" }),
      ]),
    );
    expect(plan.insert.map((r) => [r.sourceRowNumber, r.supersedesId])).toEqual([
      ["103", OLD],
      ["104", null],
    ]);
    expect(plan.mappings.map((m) => m.legacyId)).toEqual(["3", "4"]);
  });

  it("without a usable key, every row without a person is counted, none planned; a person needs no key", () => {
    const plan = planCalibrations(input([calibration("1", {}), calibration("2", { id_user: 99 }), calibration("3", { id_user: 7 })], { keyId: null, tenantName: null }));
    expect(plan.needsKey).toBe(2);
    expect(plan.insert.map((r) => r.performedBy)).toEqual([USER]);
  });

  it("ties on the numeric id are ordered by the text", () => {
    const plan = planCalibrations(input([calibration("07", { id_user: 7 }), calibration("7", { id_user: 7 })]));
    expect(plan.insert.map((r) => r.sourceRowNumber)).toEqual(["107", "107"]);
    expect(plan.mappings.map((m) => m.legacyId)).toEqual(["07", "7"]);
  });
});

describe("P24-02f the step", () => {
  const staged = [
    calibration("1", { id_user: 7, nama_ruangan: "ICU" }),
    calibration("2", { id_user: 99 }),
    calibration("3", { id_user: 7 }, { targetId: OLD, targetPresent: true, decision: "changed" }),
    calibration("4", { id_inventory: 102 }),
  ];
  const world = (extra: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } =>
    double([
      ...extra,
      [/to_regclass/, () => [{ present: true }]],
      [/AS row/, () => staged],
      [/source_table = \$1 AND legacy_id/, (c) =>
        c.bind[0] === "trx_inventory" ? [{ legacyId: "101", targetId: DEVICE }, { legacyId: "102", targetId: OLD }] : [{ legacyId: "7", targetId: USER }]],
      [/FROM calibration_devices/, () => [{ id: DEVICE, facilityId: FAC }]],
      [/FROM users u/, () => [{ id: USER, firstName: "Teknisi", lastName: "Satu", role: "TECHNICIAN", organisation: "Penyedia" }]],
      [/FROM api_keys/, () => [
        { id: "k-old", isActive: true, expiresAt: "2000-01-01T00:00:00Z", scopes: ["calibration:write"] },
        { id: KEY, isActive: true, expiresAt: "2999-01-01T00:00:00Z", scopes: ["calibration:write"] },
      ]],
      [/FROM tenants t/, () => [{ name: "Penyedia", today: "2026-10-13" }]],
      [/former_users/, () => []],
    ]);

  it("nothing staged: nothing read beyond the table check", async () => {
    const runner = double();
    await runCalibrations(context(runner));
    expect(runner.calls).toHaveLength(1);
  });

  it("reads in the provider tenant, inserts with the key and the person, closes the superseded record, audits — every value bound", async () => {
    const runner = world();
    await runCalibrations(context(runner));
    expect(runner.calls.find((c) => c.text.includes("AS row"))?.bind).toEqual([RUN, TENANT]);
    expect(runner.calls.find((c) => c.text.includes("FROM calibration_devices"))?.bind).toEqual([TENANT, [DEVICE, OLD]]);
    expect(runner.calls.find((c) => c.text.includes("FROM api_keys"))?.bind).toEqual([TENANT, "upstream-import"]);
    expect(runner.calls.find((c) => c.text.includes("FROM tenants t"))?.bind).toEqual([TENANT, "Asia/Jakarta"]);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.former_users"))?.bind).toEqual([RUN, ["99"], [1]]);
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO calibration_records"));
    expect(insert?.bind.slice(0, 2)).toEqual([RUN, TENANT]);
    expect(insert?.bind[6]).toEqual([USER, null, USER]);
    expect(insert?.bind[7]).toEqual([null, KEY, null]);
    expect(insert?.bind[11]).toEqual([null, null, OLD]);
    expect(insert?.bind.slice(12)).toEqual(["Asia/Jakarta", IMPORT_CORRECTION_REASON]);
    expect(insert?.text).toContain("'external_date'");
    const close = runner.calls.find((c) => c.text.startsWith("UPDATE calibration_records"));
    expect(close?.bind[0]).toBe(TENANT);
    expect(close?.bind[1]).toEqual([OLD]);
    expect(close?.text).toContain("t.superseded_by_id IS NULL");
    const audit = runner.calls.find((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audit?.bind.slice(0, 4)).toEqual([TENANT, "system:upstream-transform", "CalibrationRecord", RUN]);
    expect(audit?.bind[4]).toEqual(["CREATE", "CREATE", "CREATE", "UPDATE"]);
    expect(audit?.bind[6]).toEqual([FAC, FAC, FAC, FAC]);
    expect((audit?.bind[7] as string[]).map((c) => (JSON.parse(c) as { operation: string }).operation)).toEqual([
      "UPSTREAM_IMPORT",
      "UPSTREAM_IMPORT",
      "UPSTREAM_IMPORT_CORRECTION",
      "UPSTREAM_IMPORT_SUPERSEDED",
    ]);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.quarantine"))?.bind).toContain("no_device");
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("no correction: no close; nothing to write: no record, no audit", async () => {
    const plain = world([[/AS row/, () => [calibration("1", { id_user: 7 })]]]);
    await runCalibrations(context(plain));
    expect(plain.calls.some((c) => c.text.startsWith("UPDATE calibration_records"))).toBe(false);
    const none = world([[/AS row/, () => [calibration("1", { id_inventory: 999 })]], [/FROM tenants t/, () => []]]);
    await runCalibrations(context(none));
    expect(none.calls.some((c) => /INSERT INTO (calibration_records|audit_logs)/.test(c.text))).toBe(false);
  });

  it("a row with no person and no usable key fails IMPORT_KEY_MISSING before anything is written", async () => {
    const runner = world([[/FROM api_keys/, () => [{ id: "k-old", isActive: true, expiresAt: null, scopes: ["calibration:write"] }]]]);
    const failure = runCalibrations(context(runner));
    await expect(failure).rejects.toBeInstanceOf(TransformFailure);
    await expect(runCalibrations(context(runner))).rejects.toMatchObject({ code: "IMPORT_KEY_MISSING" });
    expect(runner.calls.some((c) => c.text.startsWith("INSERT"))).toBe(false);
  });
});
