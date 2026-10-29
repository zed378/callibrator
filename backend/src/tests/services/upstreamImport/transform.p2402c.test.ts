/**
 * P24-02c — the transform's catalogue steps (services/upstreamImport/transform/catalogue.ts) over a
 * statement double: the device-type and definition plans in every branch, the § 5.1 code mapping,
 * the content built by the catalogue's own `inspectionContentOf`, and what the steps send. The
 * same statements run on PostgreSQL 18 in migrations/upstreamTransform.p2402c.live.
 *
 * Synthetic values only.
 */
import type { Transaction } from "sequelize";
import { TRANSFORM_STEPS, type StepContext } from "../../../services/upstreamImport/transform/steps";
import {
  BASE_SECTIONS,
  DEFINITION_SOURCES,
  DEFINITION_TABLES,
  DEVICE_TYPE_SOURCE,
  cleanText,
  definitionOf,
  outcomesOf,
  planDefinitions,
  planDeviceTypes,
  runDeviceTypes,
  runItemDefinitions,
  type StagedCatalogueRow,
} from "../../../services/upstreamImport/transform/catalogue";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";
import { inspectionContentProblems } from "@callibrator/contracts/inspectionValues";

const RUN = "a2402000-0000-4000-8000-0000000000f3";
const TX = { id: "tx" } as unknown as Transaction;

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

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX, tenantId: "a2402000-0000-4000-8000-0000000000a1", sourceZone: "UTC" });

const staged = (legacyId: string, row: Record<string, unknown>, values: Partial<StagedCatalogueRow> = {}): StagedCatalogueRow => ({
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "d"),
  targetId: null,
  decision: "new",
  targetPresent: false,
  row,
  ...values,
});

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

describe("P24-02c the registry", () => {
  it("steps 3 and 4 are built over mst_alat and the eleven checklist tables, in 05 § 3.1's order", () => {
    expect(TRANSFORM_STEPS.find((s) => s.id === "device_types")).toMatchObject({ run: runDeviceTypes, sources: [DEVICE_TYPE_SOURCE] });
    const definitions = TRANSFORM_STEPS.find((s) => s.id === "inspection_item_definitions");
    expect(definitions).toMatchObject({ run: runItemDefinitions, sources: DEFINITION_SOURCES });
    expect(DEFINITION_SOURCES.map((s) => s.table)).toEqual(Object.keys(DEFINITION_TABLES));
    expect(DEFINITION_SOURCES.every((s) => s.legacyId === 's."id"::text')).toBe(true);
    expect([...BASE_SECTIONS].sort()).toEqual(["electrical_supply", "environment", "maintenance_task", "other_safety", "physical"]);
  });
});

describe("P24-02c text and outcomes", () => {
  it("cleanText drops control characters, collapses whitespace, trims and cuts; a non-text value is empty", () => {
    expect(cleanText("  Pompa\tInfus \n Sintetis ", 255)).toBe("Pompa Infus Sintetis");
    expect(cleanText("abcdef  ", 4)).toBe("abcd");
    expect(cleanText("ab  cd", 3)).toBe("ab");
    expect(cleanText(42, 10)).toBe("42");
    expect(cleanText(null, 10)).toBe("");
  });

  it.each([
    ["completeness", "0,1,-1", ["pass", "fail", "not_applicable"]],
    ["function", "1, 0", ["pass", "fail"]],
    ["physical", "0,1,-1", ["good", "minor_damage", "major_damage"]],
    ["tools_used", "0,1", ["done", "not_done"]],
    ["maintenance_task", "1", ["done"]],
    ["performance", "0,1", ["pass", "fail"]],
    ["electrical_safety", "1,-1", ["pass", "fail", "not_applicable"]],
    ["electrical_safety", "1", ["pass", "fail"]],
    ["electrical_supply", "1,-1", ["not_applicable"]],
    ["electrical_supply", "1", []],
    ["environment", "1,2", []],
    // Nothing named that a choice kind needs: the section's whole set.
    ["other_safety", "7,8", ["pass", "fail", "not_applicable"]],
    ["completeness", null, ["pass", "fail", "not_applicable"]],
  ] as const)("%s with codes %s → %j", (section, codes, expected) => {
    expect(outcomesOf(section, codes)).toEqual(expected);
  });
});

describe("P24-02c a definition's content", () => {
  it("performance: the setting, the reference value parsed as its limit, the limit's unit, active", () => {
    const values = definitionOf("performance", { description: " Laju  aliran ", status: "0,1", setting: "N mL/h", nilai_acuan: "± 10 %", symbol: "Q", notes: " operator only " });
    expect(values.status).toBe("active");
    expect(values.notes).toBe("operator only");
    expect(values.content).toMatchObject({
      section: "performance",
      label: "Laju aliran",
      inputKind: "setting_measured_reference",
      symbol: "Q",
      settingText: "N mL/h",
      limitOp: "plus_minus_pct",
      limitTolerance: "10",
      limitText: "± 10 %",
      allowedOutcomes: ["pass", "fail"],
    });
  });

  it("electrical safety: a ≤ limit with its unit; an unparsed one stays text; no limit column, no limit", () => {
    expect(definitionOf("electrical_safety", { description: "Arus bocor", status: "1,-1", nilai_acuan: "≤ 0,5 mA" }).content).toMatchObject({
      inputKind: "measured_with_limit",
      unit: "mA",
      limitOp: "lte",
      limitValue: "0.5",
    });
    expect(definitionOf("electrical_safety", { description: "Arus bocor", status: "1", nilai_acuan: "..." }).content).toMatchObject({ limitOp: "text", limitText: "..." });
    expect(definitionOf("electrical_safety", { description: "Arus bocor", status: "1" }).content).toMatchObject({ limitOp: null, unit: null });
  });

  it("P24-05 (the real dump): electrical safety has no nilai_acuan — its symbol is the limit and its unit, and the item is publishable", () => {
    const values = definitionOf("electrical_safety", { description: "Tahanan Hubungan Pentanahan", status: "1,-1", symbol: "≤ 0,2 Ω", notes: "1=Ya, -1=N/A", flag: 1 });
    expect(values.content).toMatchObject({ inputKind: "measured_with_limit", unit: "Ω", limitOp: "lte", limitValue: "0.2", limitText: "≤ 0,2 Ω", symbol: null });
    expect(inspectionContentProblems(values.content)).toEqual([]);
    // A nilai_acuan, where a table has one, still wins over the symbol (the synthetic shape of the earlier suites).
    expect(definitionOf("electrical_safety", { description: "Arus bocor", status: "1", symbol: "I", nilai_acuan: "≤ 100 µA" }).content).toMatchObject({
      unit: "µA",
      limitValue: "100",
      symbol: "I",
    });
    // A symbol that is no limit stays the symbol.
    expect(definitionOf("electrical_safety", { description: "Arus bocor", status: "1", symbol: "I" }).content).toMatchObject({ symbol: "I", unit: null, limitOp: null });
  });

  it("P24-05 (the real dump): a performance unit written as a parenthesised symbol is the unit; with none anywhere the item stays incomplete", () => {
    const weighed = definitionOf("performance", { description: "Akurasi Timbangan", status: "0,1", symbol: "(g)", setting: "10", nilai_acuan: "≤ 3 Kali Rsolusi" });
    expect(weighed.content).toMatchObject({ unit: "g", symbol: null, settingText: "10", limitOp: "text", limitText: "≤ 3 Kali Rsolusi" });
    expect(inspectionContentProblems(weighed.content)).toEqual([]);
    const relative = definitionOf("performance", { description: "Konsentrasi O2", status: "0,1", setting: "N20(0), O2(1), Air(0)", nilai_acuan: "± 10%" });
    expect(relative.content).toMatchObject({ unit: null, limitOp: "plus_minus_pct" });
    expect(inspectionContentProblems(relative.content)).toEqual([expect.stringContaining("needs its unit")]);
  });

  it("a base section is retired and never carries a setting or a limit; notes may be absent", () => {
    const values = definitionOf("environment", { description: "Suhu", status: "", setting: "x", nilai_acuan: "≤ 30 °C" });
    expect(values).toMatchObject({ status: "retired", notes: null });
    expect(values.content).toMatchObject({ inputKind: "measured", settingText: null, limitOp: null, unit: null, allowedOutcomes: [] });
  });
});

describe("P24-02c the device-type plan", () => {
  it("merges case/space duplicates into the lowest legacy id, adopts an existing name, inserts the rest; empty names quarantined", () => {
    const plan = planDeviceTypes(
      [
        staged("9", { nama_alat: "INFUSION  PUMP" }),
        staged("3", { nama_alat: "Infusion Pump" }),
        staged("4", { nama_alat: "  " }),
        staged("5", { nama_alat: "Syringe Pump" }),
        staged("06", { nama_alat: 123 }),
        staged("6", { nama_alat: "123" }),
      ],
      new Map([["syringe pump", "a2402000-0000-4000-8000-0000000000b5"]]),
      ids(),
    );
    expect(plan.quarantine).toEqual([{ sourceTable: "mst_alat", sourceRowNumber: "104", legacyId: "4", reason: "value_out_of_range" }]);
    expect(plan.insert).toEqual([
      { id: "a2402000-0000-4000-8000-000000000001", name: "Infusion Pump", legacyId: "3" },
      { id: "a2402000-0000-4000-8000-000000000002", name: "123", legacyId: "06" },
    ]);
    expect(plan.adopt).toEqual([{ id: "a2402000-0000-4000-8000-0000000000b5", legacyId: "5" }]);
    expect(plan.mappings.map((m) => [m.legacyId, m.targetId, m.tenantId, m.sourceValues])).toEqual([
      ["3", "a2402000-0000-4000-8000-000000000001", null, null],
      ["9", "a2402000-0000-4000-8000-000000000001", null, { mergedIntoLegacyId: "3", nama_alat: "INFUSION  PUMP" }],
      ["5", "a2402000-0000-4000-8000-0000000000b5", null, null],
      ["06", "a2402000-0000-4000-8000-000000000002", null, null],
      ["6", "a2402000-0000-4000-8000-000000000002", null, { mergedIntoLegacyId: "06" }],
    ]);
  });

  it("re-runs: unchanged skips, a changed survivor renames, a vanished type is made again", () => {
    const kept = "a2402000-0000-4000-8000-0000000000c1";
    const changed = "a2402000-0000-4000-8000-0000000000c2";
    const plan = planDeviceTypes(
      [
        staged("1", { nama_alat: "Kept" }, { decision: "unchanged", targetId: kept, targetPresent: true }),
        staged("2", { nama_alat: "Renamed" }, { decision: "changed", targetId: changed, targetPresent: true }),
        staged("3", { nama_alat: "Gone" }, { decision: "unchanged", targetId: "a2402000-0000-4000-8000-0000000000c3", targetPresent: false }),
      ],
      new Map(),
      ids(),
    );
    expect(plan.rename).toEqual([{ id: changed, name: "Renamed" }]);
    expect(plan.insert.map((i) => i.legacyId)).toEqual(["3"]);
    expect(plan.mappings.map((m) => m.legacyId)).toEqual(["2", "3"]);
  });
});

describe("P24-02c the definitions plan", () => {
  it("inserts new rows, updates changed ones, skips unchanged; an empty label is quarantined", () => {
    const changed = "a2402000-0000-4000-8000-0000000000c2";
    const plan = planDefinitions(
      "mst_kelengkapan_alat",
      [
        staged("2", { description: "Kabel daya", status: "0,1,-1" }),
        staged("1", { description: "Manual", status: "1" }, { decision: "unchanged", targetId: "a2402000-0000-4000-8000-0000000000c1", targetPresent: true }),
        staged("3", { description: "Adaptor", status: "0,1" }, { decision: "changed", targetId: changed, targetPresent: true }),
        staged("4", { description: " " }),
      ],
      ids(),
    );
    expect(plan.insert.map((i) => [i.id, i.table, i.legacyId, i.values.content.section, i.values.content.allowedOutcomes])).toEqual([
      ["a2402000-0000-4000-8000-000000000001", "mst_kelengkapan_alat", "2", "completeness", ["pass", "fail", "not_applicable"]],
    ]);
    expect(plan.update.map((u) => [u.id, u.values.content.label])).toEqual([[changed, "Adaptor"]]);
    expect(plan.mappings.map((m) => [m.legacyId, m.targetTable, m.tenantId])).toEqual([
      ["2", "inspection_item_definitions", null],
      ["3", "inspection_item_definitions", null],
    ]);
    expect(plan.quarantine).toEqual([{ sourceTable: "mst_kelengkapan_alat", sourceRowNumber: "104", legacyId: "4", reason: "value_out_of_range" }]);
  });

  it("the recommendation's answers are a session header value, never a definition", () => {
    const plan = planDefinitions("mst_rekomendasi_hasil_pekerjaan", [staged("1", { description: "Laik pakai", status: "1" })], ids());
    expect(plan).toEqual({ insert: [], update: [], mappings: [], quarantine: [{ sourceTable: "mst_rekomendasi_hasil_pekerjaan", sourceRowNumber: "101", legacyId: "1", reason: "session_header_value" }] });
  });

  it("a table off the list has no section (a session header value)", () => {
    expect(planDefinitions("mst_unknown", [staged("1", {})], ids()).quarantine[0]?.reason).toBe("session_header_value");
  });
});

describe("P24-02c the steps", () => {
  it("device types: nothing without mst_alat; else the read, the name lookup, insert / adopt / rename, quarantine and maps — bound", async () => {
    const none = double([[/to_regclass/, () => [{ present: false }]]]);
    await runDeviceTypes(context(none));
    expect(none.calls).toHaveLength(1);

    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/LEFT JOIN device_types t/, () => [
        staged("1", { nama_alat: "Pump" }),
        staged("2", { nama_alat: "Made" }),
        staged("3", { nama_alat: "Renamed" }, { decision: "changed", targetId: "a2402000-0000-4000-8000-0000000000c3", targetPresent: true }),
        staged("4", { nama_alat: "" }),
      ]],
      [/FROM device_types WHERE lower/, () => [{ id: "a2402000-0000-4000-8000-0000000000b2", key: "made" }]],
    ]);
    await runDeviceTypes(context(runner));
    const [, read, lookup, insert, adopt, rename, quarantine, mappings, ...rest] = runner.calls;
    expect(rest).toEqual([]);
    expect(read?.bind).toEqual([RUN]);
    expect(read?.text).toContain("to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row");
    expect(read?.text).toContain('JOIN upstream_import."stg_mst_alat" s');
    expect(lookup?.bind).toEqual([["pump", "made", "renamed"]]);
    expect(insert?.bind).toEqual([[expect.any(String)], ["Pump"], ["1"]]);
    expect(adopt?.bind).toEqual([["a2402000-0000-4000-8000-0000000000b2"], ["2"]]);
    expect(rename?.bind).toEqual([["a2402000-0000-4000-8000-0000000000c3"], ["Renamed"]]);
    expect(quarantine?.bind).toEqual([RUN, "mst_alat", "104", "4", "value_out_of_range"]);
    expect(mappings?.text).toContain("INSERT INTO upstream_import.id_map");
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("device types with nothing to write still quarantine and map nothing else", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/LEFT JOIN device_types t/, () => [staged("1", { nama_alat: "Kept" }, { decision: "unchanged", targetId: "a2402000-0000-4000-8000-0000000000c1", targetPresent: true })]],
    ]);
    await runDeviceTypes(context(runner));
    expect(runner.calls.some((c) => /^\s*(INSERT INTO device_types|UPDATE device_types)/.test(c.text))).toBe(false);
  });

  it("definitions: every present checklist table read, inserted and updated with every column bound; absent tables skipped", async () => {
    const runner = double([
      [/to_regclass/, (call) => [{ present: call.bind[0] === "upstream_import.stg_mst_kelengkapan_alat" || call.bind[0] === "upstream_import.stg_mst_rekomendasi_hasil_pekerjaan" }]],
      [/stg_mst_kelengkapan_alat" s/, () => [
        staged("1", { description: "Kabel", status: "0,1,-1", notes: "n" }),
        staged("2", { description: "Manual", status: "1" }, { decision: "changed", targetId: "a2402000-0000-4000-8000-0000000000c2", targetPresent: true }),
      ]],
      [/stg_mst_rekomendasi_hasil_pekerjaan" s/, () => [staged("1", { description: "Laik", status: "1" })]],
    ]);
    await runItemDefinitions(context(runner));
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO inspection_item_definitions"));
    expect(insert?.bind).toHaveLength(24);
    // An empty outcome list is stored as an empty array (the column is NOT NULL), never NULL.
    expect(insert?.text).toContain("coalesce(string_to_array(nullif(v.outcomes, ''), ','), '{}')");
    expect(insert?.bind.slice(1, 4)).toEqual([["completeness"], ["Kabel"], ["tri_state"]]);
    expect(insert?.bind.slice(19, 24)).toEqual([["pass,fail,not_applicable"], ["n"], ["active"], "mst_kelengkapan_alat", ["1"]]);
    const update = runner.calls.find((c) => c.text.startsWith("UPDATE inspection_item_definitions"));
    expect(update?.bind).toHaveLength(22);
    expect(update?.bind[0]).toEqual(["a2402000-0000-4000-8000-0000000000c2"]);
    expect(update?.bind[19]).toEqual(["pass"]);
    expect(runner.calls.filter((c) => c.text.includes("upstream_import.quarantine")).map((c) => c.bind)).toEqual([
      [RUN, "mst_rekomendasi_hasil_pekerjaan", "101", "1", "session_header_value"],
    ]);
    expect(runner.calls.filter((c) => c.text.startsWith("SELECT c.")).length).toBe(2);
  });
});
