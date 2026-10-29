/**
 * P24-02h — the device rows' own calibration dates (`trx_inventory.tgl_kalibrasi`), decided by the
 * owner on 2026-10-28 (UD-8): the date the operator calibrated the device; the interval is set per
 * request or standard, so no due date is derived. `planInventoryDates` is pure: every branch is
 * driven here; the SQL runs on PostgreSQL 18 in upstreamTransform.p2402f.live.
 */
import type { Transaction } from "sequelize";
import {
  INVENTORY_DATE_SOURCE,
  accountInventoryDates,
  planInventoryDates,
  runCalibrations,
  type InventoryDateInput,
  type StagedInventoryDate,
} from "../../../services/upstreamImport/transform/calibrations";
import type { StepContext } from "../../../services/upstreamImport/transform/steps";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const TENANT = "a2402800-0000-4000-8000-0000000000a1";
const KEY = "a2402800-0000-4000-8000-000000000001";
const DEVICE = "a2402800-0000-4000-8000-0000000000d1";
const FACILITY = "a2402800-0000-4000-8000-0000000000f1";
const EXISTING = "a2402800-0000-4000-8000-0000000000e1";

const row = (legacyId: string, raw: string, extra: Partial<StagedInventoryDate> = {}): StagedInventoryDate => ({
  sourceRowNumber: legacyId,
  legacyId,
  raw,
  room: null,
  rowHash: `h-${raw}`,
  targetId: null,
  mappedHash: null,
  targetPresent: false,
  targetClosed: false,
  ...extra,
});

const input = (rows: StagedInventoryDate[], extra: Partial<InventoryDateInput> = {}): InventoryDateInput => {
  let n = 0;
  return {
    rows,
    tenantId: TENANT,
    tenantName: "Penyedia Sintetis",
    today: "2026-10-28",
    devices: new Map([
      ["1", { id: DEVICE, facilityId: FACILITY }],
      ["2", { id: DEVICE, facilityId: FACILITY }],
    ]),
    effective: new Map(),
    keyId: KEY,
    newId: () => `new-${String((n += 1))}`,
    ...extra,
  };
};

describe("P24-02h the device's own calibration date", () => {
  it("is its own accounted column source: id_map and quarantine name `tgl_kalibrasi`", () => {
    expect(INVENTORY_DATE_SOURCE).toBe("tgl_kalibrasi");
  });

  it("quarantines a device that was not imported, a date that is no calendar day, and a future date", () => {
    const plan = planInventoryDates(input([row("9", "2025-01-01"), row("1", "2025-02-30"), row("2", "2026-10-29")]));
    expect(plan.insert).toEqual([]);
    expect(plan.mappings).toEqual([]);
    expect(plan.quarantine).toEqual([
      { sourceTable: "tgl_kalibrasi", sourceRowNumber: "1", legacyId: "1", reason: "value_out_of_range" },
      { sourceTable: "tgl_kalibrasi", sourceRowNumber: "2", legacyId: "2", reason: "future_calibration_date" },
      { sourceTable: "tgl_kalibrasi", sourceRowNumber: "9", legacyId: "9", reason: "no_device" },
    ]);
  });

  it("a new date is an external_date record by the import key, the device's room, no person and no due date", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01", { room: "  ICU  " })]));
    expect(plan.insert).toEqual([
      {
        id: "new-1",
        sourceRowNumber: "1",
        deviceId: DEVICE,
        facilityId: FACILITY,
        calibrationDate: "2025-04-01",
        performedBy: null,
        apiKeyId: KEY,
        roomSnapshot: "ICU",
        performerSnapshot: { name: "Upstream import", role: "import", organisation: "Penyedia Sintetis", source: "upstream-import" },
        supersedesId: null,
      },
    ]);
    expect(plan.mappings).toEqual([
      {
        sourceTable: "tgl_kalibrasi",
        legacyId: "1",
        targetTable: "calibration_records",
        targetId: "new-1",
        tenantId: TENANT,
        clientFacilityId: FACILITY,
        rowHash: "h-2025-04-01",
        sourceValues: null,
      },
    ]);
  });

  it("a timestamp keeps its day", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01 00:00:00")]));
    expect(plan.insert.map((r) => r.calibrationDate)).toEqual(["2025-04-01"]);
  });

  it("one calibration is one record: a date the device already has an effective record for maps onto it", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01")], { effective: new Map([[`${DEVICE}|2025-04-01`, EXISTING]]) }));
    expect(plan.insert).toEqual([]);
    expect(plan.mappings.map((m) => [m.sourceTable, m.legacyId, m.targetId])).toEqual([["tgl_kalibrasi", "1", EXISTING]]);
  });

  it("an unchanged date, or a record the operator voided or corrected, is left alone", () => {
    const unchanged = row("1", "2025-04-01", { targetId: EXISTING, targetPresent: true, mappedHash: "h-2025-04-01" });
    const closed = row("2", "2025-05-01", { targetId: EXISTING, targetPresent: true, mappedHash: "h-old", targetClosed: true });
    const plan = planInventoryDates(input([unchanged, closed]));
    expect(plan).toEqual({ insert: [], mappings: [], quarantine: [], needsKey: 0 });
  });

  it("a changed date is a correction of the record it mapped to", () => {
    const changed = row("1", "2025-04-03", { targetId: EXISTING, targetPresent: true, mappedHash: "h-2025-04-01" });
    const plan = planInventoryDates(input([changed], { effective: new Map([[`${DEVICE}|2025-04-03`, "other"]]) }));
    expect(plan.insert.map((r) => [r.calibrationDate, r.supersedesId])).toEqual([["2025-04-03", EXISTING]]);
    expect(plan.mappings.map((m) => m.targetId)).toEqual(["new-1"]);
  });

  it("without a usable import key, a date that needs a record is counted, never written", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01")], { keyId: null }));
    expect(plan).toEqual({ insert: [], mappings: [], quarantine: [], needsKey: 1 });
  });

  it("a mapped same-day date needs no key", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01")], { keyId: null, effective: new Map([[`${DEVICE}|2025-04-01`, EXISTING]]) }));
    expect(plan.needsKey).toBe(0);
    expect(plan.mappings.map((m) => m.targetId)).toEqual([EXISTING]);
  });

  it("ties on the numeric id are ordered by the text; a room that cleans to nothing is no room", () => {
    const plan = planInventoryDates(
      input([row("01", "2025-04-02", { room: " \t " }), row("1", "2025-04-01")], {
        devices: new Map([
          ["1", { id: DEVICE, facilityId: FACILITY }],
          ["01", { id: DEVICE, facilityId: FACILITY }],
        ]),
      }),
    );
    expect(plan.insert.map((r) => [r.sourceRowNumber, r.roomSnapshot])).toEqual([
      ["01", null],
      ["1", null],
    ]);
  });
});

// ------------------------------------------------------------------
// The step's second pass and its accounting, over a statement double. The same statements run on
// PostgreSQL 18 in migrations/upstreamTransform.p2402f.live; here every branch of the pass is driven.
// ------------------------------------------------------------------

const RUN = "a2402800-0000-4000-8000-0000000000f6";
const TX = { id: "tx" } as unknown as Transaction;

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}
type Rule = [RegExp, (call: Call) => object[]];

const double = (rules: Rule[]): SqlRunner & { calls: Call[] } => {
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

/** Only `trx_inventory` is staged (no `trx_kalibrasi`), unless `tables` says otherwise. */
const staged = (tables: readonly string[] = ["trx_inventory"]): Rule => [
  /to_regclass/,
  (c) => [{ present: tables.some((t) => String(c.bind[0]).endsWith(t)) }],
];

const world = (dates: StagedInventoryDate[], extra: Rule[] = []): SqlRunner & { calls: Call[] } =>
  double([
    ...extra,
    staged(),
    [/AS raw/, () => dates],
    [/source_table = \$1 AND legacy_id/, () => [{ legacyId: "1", targetId: DEVICE }, { legacyId: "2", targetId: DEVICE }, { legacyId: "3", targetId: "gone" }]],
    [/FROM calibration_devices/, () => [{ id: DEVICE, facilityId: FACILITY }]],
    [/AS day FROM calibration_records/, () => [{ id: EXISTING, deviceId: DEVICE, day: "2025-03-01" }]],
    [/FROM api_keys/, () => [{ id: KEY, isActive: true, expiresAt: "2999-01-01T00:00:00Z", scopes: ["calibration:write"] }]],
    [/FROM tenants t/, () => [{ name: "Penyedia Sintetis", today: "2026-10-28" }]],
  ]);

describe("P24-02h the step's device-date pass", () => {
  it("only trx_inventory staged: the dates are planned against the devices present and the effective records, then written from trx_inventory", async () => {
    const runner = world([row("1", "2025-04-01"), row("2", "2025-03-01"), row("3", "2025-04-01")]);
    await runCalibrations(context(runner));
    expect(runner.calls.some((c) => c.text.includes("AS row"))).toBe(false); // no trx_kalibrasi pass
    expect(runner.calls.find((c) => c.text.includes("AS raw"))?.bind).toEqual([RUN, TENANT, "tgl_kalibrasi"]);
    expect(runner.calls.find((c) => c.text.includes("FROM calibration_devices"))?.bind).toEqual([TENANT, [DEVICE, "gone"]]);
    expect(runner.calls.find((c) => c.text.includes("AS day FROM calibration_records"))?.bind).toEqual([TENANT, [DEVICE], "Asia/Jakarta"]);
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO calibration_records"));
    expect(insert?.text).toContain('JOIN upstream_import."stg_trx_inventory" s');
    expect(insert?.bind[2]).toHaveLength(1); // row 1 is new; row 2 maps onto its same-day record; row 3's device is gone
    expect(insert?.bind[8]).toEqual(["2025-04-01"]);
    const audit = runner.calls.find((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audit?.bind[8]).toBe("tgl_kalibrasi");
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.quarantine"))?.bind).toContain("no_device");
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("both tables staged and no device date: the pass reads the dates and stops", async () => {
    const runner = double([staged(["trx_kalibrasi", "trx_inventory"]), [/FROM tenants t/, () => [{ name: "Penyedia Sintetis", today: "2026-10-28" }]]]);
    await runCalibrations(context(runner));
    expect(runner.calls.some((c) => c.text.includes("AS raw"))).toBe(true);
    expect(runner.calls.some((c) => c.text.includes("AS day FROM calibration_records"))).toBe(false);
  });

  it("only trx_kalibrasi staged: the device-date pass does not run", async () => {
    const runner = double([staged(["trx_kalibrasi"]), [/FROM tenants t/, () => [{ name: "Penyedia Sintetis", today: "2026-10-28" }]]]);
    await runCalibrations(context(runner));
    expect(runner.calls.some((c) => c.text.includes("AS raw"))).toBe(false);
  });

  it("a date that needs a record and no usable key fails IMPORT_KEY_MISSING before anything is written", async () => {
    const runner = world([row("1", "2025-04-01")], [[/FROM api_keys/, () => []]]);
    await expect(runCalibrations(context(runner))).rejects.toMatchObject({ code: "IMPORT_KEY_MISSING" });
    expect(runner.calls.some((c) => c.text.startsWith("INSERT"))).toBe(false);
  });
});

describe("P24-02h the step's accounting of the device dates", () => {
  it("counts the staged dates and the quarantine reasons, every value bound", async () => {
    const runner = double([
      staged(),
      [/AS staged/, () => [{ staged: 4, mapped: 2, unchanged: 1, unaccounted: 0 }]],
      [/SELECT reason, count/, () => [{ reason: "no_device", n: 1 }]],
    ]);
    expect(await accountInventoryDates(context(runner))).toEqual([
      { table: "tgl_kalibrasi", staged: 4, mapped: 2, unchanged: 1, quarantined: { no_device: 1 }, unaccounted: 0 },
    ]);
    expect(runner.calls.find((c) => c.text.includes("AS staged"))?.bind).toEqual([RUN, "tgl_kalibrasi"]);
  });

  it("a count statement that answers no row reads as zeros; no staged table counts only the quarantine", async () => {
    const empty = double([staged()]);
    expect(await accountInventoryDates(context(empty))).toEqual([
      { table: "tgl_kalibrasi", staged: 0, mapped: 0, unchanged: 0, quarantined: {}, unaccounted: 0 },
    ]);
    const none = double([staged([])]);
    await accountInventoryDates(context(none));
    expect(none.calls.some((c) => c.text.includes("AS staged"))).toBe(false);
  });
});
