/**
 * P22-01 — the catalogue page's pure helpers. Expected values are written by hand from the spec
 * (P19-01 § 5, § 6.2, § 7.2, § 8.2 "as built"), not read back from the helpers.
 */
import type { ItemDefinition, TemplateItem } from "@/api/services/ipmCatalogue.service";
import {
  contentBodyOf,
  contentProblems,
  draftItemsOf,
  draftRowOfDefinition,
  draftRowsOf,
  groupBySection,
  limitSymbolic,
  moveInSection,
  orderedItems,
  type ContentFields,
} from "../catalogue";

const fields = (over: Partial<ContentFields> = {}): ContentFields => ({
  section: "function",
  label: "Alarm sounds",
  inputKind: "tri_state",
  unit: null,
  symbol: null,
  settingText: null,
  settingValue: null,
  limitText: null,
  validMin: null,
  validMax: null,
  warnMin: null,
  warnMax: null,
  allowedOutcomes: ["pass", "fail", "not_applicable"],
  ...over,
});

let n = 0;
const item = (over: Partial<TemplateItem> = {}): TemplateItem => {
  n += 1;
  return {
    id: `item-${String(n)}`,
    itemDefinitionId: `def-${String(n)}`,
    origin: "type",
    section: "function",
    label: `Item ${String(n)}`,
    inputKind: "tri_state",
    unit: null,
    symbol: null,
    settingText: null,
    settingValue: null,
    limitOp: null,
    limitValue: null,
    limitLow: null,
    limitHigh: null,
    limitNominal: null,
    limitTolerance: null,
    limitText: null,
    validMin: null,
    validMax: null,
    warnMin: null,
    warnMax: null,
    allowedOutcomes: ["pass", "fail"],
    required: true,
    sortOrder: n,
    ...over,
  };
};

describe("contentBodyOf — the strict union the API takes", () => {
  it("an outcome kind carries its outcomes and no measured field", () => {
    expect(contentBodyOf(fields({ label: "  Alarm sounds ", symbol: " " }))).toEqual({
      section: "function",
      label: "Alarm sounds",
      symbol: null,
      inputKind: "tri_state",
      allowedOutcomes: ["pass", "fail", "not_applicable"],
    });
    expect(contentBodyOf(fields({ section: "tools_used", inputKind: "check", allowedOutcomes: ["done", "not_done"] }))).toMatchObject({ inputKind: "check" });
    expect(contentBodyOf(fields({ section: "physical", inputKind: "condition_clean", allowedOutcomes: ["good"] }))).toMatchObject({ inputKind: "condition_clean", allowedOutcomes: ["good"] });
  });

  it("a text item carries nothing but its head", () => {
    expect(contentBodyOf(fields({ inputKind: "text", allowedOutcomes: ["pass"] }))).toEqual({ section: "function", label: "Alarm sounds", symbol: null, inputKind: "text" });
  });

  it("a measured item carries its unit and ranges; a limit kind its limit TEXT; a setting item its setting", () => {
    expect(contentBodyOf(fields({ section: "environment", inputKind: "measured", unit: "°C", validMin: "0", validMax: " ", allowedOutcomes: [] }))).toEqual({
      section: "environment",
      label: "Alarm sounds",
      symbol: null,
      inputKind: "measured",
      unit: "°C",
      validMin: "0",
      validMax: null,
      warnMin: null,
      warnMax: null,
      allowedOutcomes: [],
    });
    expect(contentBodyOf(fields({ section: "electrical_safety", inputKind: "measured_with_limit", unit: "µA", limitText: "≤ 100 µA" }))).toMatchObject({
      inputKind: "measured_with_limit",
      limitText: "≤ 100 µA",
    });
    expect(
      contentBodyOf(fields({ section: "performance", inputKind: "setting_measured_reference", unit: "mL/h", settingText: "100 mL/h", settingValue: "100", limitText: "± 10 %", allowedOutcomes: ["pass", "fail"] })),
    ).toMatchObject({ inputKind: "setting_measured_reference", settingText: "100 mL/h", settingValue: "100", limitText: "± 10 %" });
  });

  it("a measured item without a unit sends an empty unit (the server's 400 names it)", () => {
    expect(contentBodyOf(fields({ section: "environment", inputKind: "measured", unit: null, allowedOutcomes: [] }))).toMatchObject({ unit: "" });
  });
});

describe("contentProblems — the shared rules, before the server", () => {
  it("is empty for a valid item and for an item with no label yet", () => {
    expect(contentProblems(fields())).toEqual([]);
    expect(contentProblems(fields({ label: " ", allowedOutcomes: [] }))).toEqual([]);
  });

  it("names a limit in a unit the item does not record, and a missing outcome", () => {
    const problems = contentProblems(fields({ section: "electrical_safety", inputKind: "measured_with_limit", unit: "µA", limitText: "≤ 0,5 mA" }));
    expect(problems.join(" ")).toMatch(/limit is in mA but the item records µA/);
    expect(contentProblems(fields({ allowedOutcomes: [] })).join(" ")).toMatch(/at least one allowed outcome/);
  });
});

describe("the draft editor's rows", () => {
  it("keeps the draft's own copy for an item already in it, and lets the server copy a new one", () => {
    const kept = item({ label: "Edited copy", required: false });
    const definition = { ...item({ label: "Fresh from library" }), id: "def-new", defaultRequired: true, notes: null, status: "active" } as unknown as ItemDefinition;
    const rows = [...draftRowsOf([kept]), draftRowOfDefinition(definition)];
    const items = draftItemsOf(rows);
    expect(items).toEqual([
      { itemDefinitionId: kept.itemDefinitionId, required: false, content: expect.objectContaining({ label: "Edited copy", inputKind: "tri_state" }) },
      { itemDefinitionId: "def-new", required: true },
    ]);
  });

  it("sends the items section by section, each in the editor's order", () => {
    const a = item({ section: "function", label: "F1" });
    const b = item({ section: "tools_used", inputKind: "check", label: "T1" });
    const c = item({ section: "function", label: "F2" });
    const rows = draftRowsOf([a, b, c]);
    // Read order puts tools_used (section 3) before function (section 7).
    expect(draftItemsOf(rows).map((i) => i.itemDefinitionId)).toEqual([b.itemDefinitionId, a.itemDefinitionId, c.itemDefinitionId]);
  });

  it("moves a row only among its own section's rows, and not past either end", () => {
    const rows = draftRowsOf([item({ label: "F1" }), item({ section: "tools_used", inputKind: "check", label: "T1" }), item({ label: "F2" })]);
    // rows in read order: T1, F1, F2
    expect(rows.map((r) => r.shown.label)).toEqual(["T1", "F1", "F2"]);
    expect(moveInSection(rows, 2, -1).map((r) => r.shown.label)).toEqual(["T1", "F2", "F1"]);
    expect(moveInSection(rows, 1, -1).map((r) => r.shown.label)).toEqual(["T1", "F1", "F2"]);
    expect(moveInSection(rows, 2, 1).map((r) => r.shown.label)).toEqual(["T1", "F1", "F2"]);
    expect(moveInSection(rows, 9, 1)).toEqual(rows);
  });
});

describe("read order and grouping", () => {
  it("orders by section registry, base before type, then sort order", () => {
    const items = [
      item({ section: "function", origin: "type", sortOrder: 2, label: "type 2" }),
      item({ section: "function", origin: "base", sortOrder: 9, label: "base 9" }),
      item({ section: "environment", origin: "base", sortOrder: 5, label: "env" }),
      item({ section: "function", origin: "type", sortOrder: 1, label: "type 1" }),
    ];
    expect(orderedItems(items).map((i) => i.label)).toEqual(["env", "base 9", "type 1", "type 2"]);
  });

  it("groups in registry order and leaves empty sections out", () => {
    const groups = groupBySection([{ s: "consumable" }, { s: "environment" }, { s: "consumable" }] as const, (x) => x.s);
    expect(groups.map(([section, g]) => [section, g.length])).toEqual([
      ["environment", 1],
      ["consumable", 2],
    ]);
  });
});

describe("limitSymbolic — the preview of how the server reads a limit", () => {
  it.each([
    ["≤ 0,5 mA", "≤ 0.5 mA"],
    ["< 100 µA", "< 100 µA"],
    [">= 2 MΩ", "≥ 2 MΩ"],
    ["> 10 V", "> 10 V"],
    ["20 - 25 °C", "20 – 25 °C"],
    ["± 10 %", "± 10 %"],
    ["100 ± 5 %", "100 ± 5 %"],
    ["± 0,2 V", "± 0.2 V"],
    ["5 ± 1", "5 ± 1"],
  ])("%s reads as %s", (input, expected) => {
    expect(limitSymbolic(input)).toBe(expected);
  });

  it("is null for no limit and for a limit kept as text", () => {
    expect(limitSymbolic(null)).toBeNull();
    expect(limitSymbolic("see the manual")).toBeNull();
  });
});
