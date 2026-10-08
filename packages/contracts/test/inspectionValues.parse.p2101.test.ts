/**
 * P21-01 (spec MEMORY/specs/P19-01-inspection-catalogue.md § 6, § 7.5; ADR-125 Am. 1 § 3) — the one
 * parser and evaluator the server, the offline client and the ETL share: `parseDecimal`,
 * `normaliseUnit`, `parseLimit`, `evaluate`, `resolveTemplateVersion`, and the item content's
 * builder and checks. Every expectation is the spec's table written out by hand (synthetic numbers),
 * never read back from the module.
 */
import {
  UNIT_ALIASES,
  evaluate,
  inspectionContentOf,
  inspectionContentProblems,
  normaliseUnit,
  parseDecimal,
  parseLimit,
  resolveTemplateVersion,
  type InspectionItemContent,
} from "../src/inspectionValues";

describe("parseDecimal (§ 6.1)", () => {
  it.each([
    ["0,7", "0.7"],
    [" 12 ", "12"],
    ["-3.5", "-3.5"],
    ["+4,50", "4.5"],
    ["1.200", "1.2"],
    ["1,000", "1"],
    [7, "7"],
    [0.25, "0.25"],
  ] as const)("%j → %j", (input, value) => {
    expect(parseDecimal(input)).toEqual({ value, raw: String(input) });
  });

  it.each(["1.000,5", "1,000.5", "1 000", "", "   ", "1e-7", "abc", "1.", ".5"])("refuses %j (value null, raw kept)", (input) => {
    expect(parseDecimal(input)).toEqual({ value: null, raw: input });
  });

  it("a number with an exponent or NaN is refused; null and undefined are empty", () => {
    expect(parseDecimal(1e-7).value).toBeNull();
    expect(parseDecimal(Number.NaN).value).toBeNull();
    expect(parseDecimal(null)).toEqual({ value: null, raw: "" });
    expect(parseDecimal(undefined)).toEqual({ value: null, raw: "" });
  });
});

describe("normaliseUnit (§ 6.3)", () => {
  it.each([
    ["uA", "µA"],
    ["μA", "µA"],
    ["µA", "µA"],
    ["ohm", "Ω"],
    ["OHM", "Ω"],
    ["Ω", "Ω"],
    ["kΩ", "kΩ"],
    ["kohm", "kΩ"],
    ["Mohm", "MΩ"],
    ["mohm", "mΩ"],
    ["C", "°C"],
    ["˚C", "°C"],
    ["ºC", "°C"],
    ["%RH", "%"],
    ["BPM", "bpm"],
    ["lpm", "L/min"],
    ["l/min", "L/min"],
    ["ml/h", "mL/h"],
    [" mmHg ", "mmHg"],
    ["mmAl", "mmAl"],
  ])("%j → %j", (token, unit) => {
    expect(normaliseUnit(token)).toBe(unit);
  });

  it("keeps an unknown token (at most 20 characters); nothing is null", () => {
    expect(normaliseUnit("widgets")).toBe("widgets");
    expect(normaliseUnit("x".repeat(25))).toBe("x".repeat(20));
    expect(normaliseUnit("  ")).toBeNull();
    expect(normaliseUnit(null)).toBeNull();
    expect(normaliseUnit(undefined)).toBeNull();
    expect(Object.isFrozen(UNIT_ALIASES)).toBe(true);
  });
});

describe("parseLimit (§ 6.2)", () => {
  const limit = (over: Record<string, unknown>): Record<string, unknown> => ({
    value: null,
    low: null,
    high: null,
    nominal: null,
    tolerance: null,
    unit: null,
    ...over,
  });

  it.each([
    ["≤ 0,7 Ω", limit({ op: "lte", value: "0.7", unit: "Ω", text: "≤ 0,7 Ω" })],
    ["<= 100 uA", limit({ op: "lte", value: "100", unit: "µA", text: "<= 100 uA" })],
    ["< 5s", limit({ op: "lt", value: "5", unit: "s", text: "< 5s" })],
    ["≥ 2,5 mmAl", limit({ op: "gte", value: "2.5", unit: "mmAl", text: "≥ 2,5 mmAl" })],
    [">= 3", limit({ op: "gte", value: "3", text: ">= 3" })],
    ["> 1 %", limit({ op: "gt", value: "1", unit: "%", text: "> 1 %" })],
    ["Max 30 psi", limit({ op: "lte", value: "30", unit: "psi", text: "Max 30 psi" })],
    ["maks. 4", limit({ op: "lte", value: "4", text: "maks. 4" })],
    ["Min 2 L/min", limit({ op: "gte", value: "2", unit: "L/min", text: "Min 2 L/min" })],
    ["± 10%", limit({ op: "plus_minus_pct", tolerance: "10", text: "± 10%" })],
    ["+/- 2 °C", limit({ op: "plus_minus", tolerance: "2", unit: "°C", text: "+/- 2 °C" })],
    ["±0,5 D", limit({ op: "plus_minus", tolerance: "0.5", unit: "D", text: "±0,5 D" })],
    ["+- 3", limit({ op: "plus_minus", tolerance: "3", text: "+- 3" })],
    ["120 ± 3 mmHg", limit({ op: "plus_minus", nominal: "120", tolerance: "3", unit: "mmHg", text: "120 ± 3 mmHg" })],
    ["60 ± 5 %", limit({ op: "plus_minus_pct", nominal: "60", tolerance: "5", text: "60 ± 5 %" })],
    ["50 ± 1", limit({ op: "plus_minus", nominal: "50", tolerance: "1", text: "50 ± 1" })],
    ["36 – 38 ˚C", limit({ op: "between", low: "36", high: "38", unit: "°C", text: "36 – 38 °C" })],
    ["10 - 20", limit({ op: "between", low: "10", high: "20", text: "10 - 20" })],
    ["1 s.d. 3 V", limit({ op: "between", low: "1", high: "3", unit: "V", text: "1 s.d. 3 V" })],
    ["2 to 4", limit({ op: "between", low: "2", high: "4", text: "2 to 4" })],
  ])("%j", (text, parsed) => {
    expect(parseLimit(text)).toEqual(parsed);
  });

  it.each(["...", "≤ 2 × resolution", "RH%", "20 - 10", "± -3", "about five"])("%j stays text: printed as written, never evaluated", (text) => {
    expect(parseLimit(text)).toEqual(limit({ op: "text", text }));
  });

  it("collapses whitespace; empty is no limit", () => {
    expect(parseLimit("  ≤   5   V ")?.text).toBe("≤ 5 V");
    expect(parseLimit("   ")).toBeNull();
    expect(parseLimit(null)).toBeNull();
    expect(parseLimit(undefined)).toBeNull();
  });
});

describe("evaluate (§ 6.4)", () => {
  const lte = { limitOp: "lte", limitValue: "0.7" } as const;

  it("inclusive boundaries, on scaled integers", () => {
    expect(evaluate(lte, ["0.7"])).toBe("pass");
    expect(evaluate(lte, ["0.7000001"])).toBe("fail");
    expect(evaluate({ limitOp: "lte", limitValue: "0.3" }, ["0.30000000000000004"])).toBe("fail");
    // Decimal arithmetic: 0.1 + 0.2 entered as the decimal it means is exactly the bound.
    expect(evaluate({ limitOp: "lte", limitValue: "0.3" }, ["0.30"])).toBe("pass");
    expect(evaluate({ limitOp: "lt", limitValue: "5" }, ["5"])).toBe("fail");
    expect(evaluate({ limitOp: "gt", limitValue: "5" }, ["5,1"])).toBe("pass");
    expect(evaluate({ limitOp: "gte", limitValue: "-2" }, ["-2.5"])).toBe("fail");
  });

  it("between, tolerance around a setting, and a percentage of a negative nominal", () => {
    expect(evaluate({ limitOp: "between", limitLow: "36", limitHigh: "38" }, ["38"])).toBe("pass");
    expect(evaluate({ limitOp: "between", limitLow: "36", limitHigh: "38" }, ["35.99"])).toBe("fail");
    expect(evaluate({ limitOp: "plus_minus", limitTolerance: "3", settingValue: "120" }, ["123"])).toBe("pass");
    expect(evaluate({ limitOp: "plus_minus", limitTolerance: "3", limitNominal: "100", settingValue: "120" }, ["123"])).toBe("fail");
    expect(evaluate({ limitOp: "plus_minus_pct", limitTolerance: "10", limitNominal: "-50" }, ["-55"])).toBe("pass");
    expect(evaluate({ limitOp: "plus_minus_pct", limitTolerance: "10", limitNominal: "-50" }, ["-55.01"])).toBe("fail");
    expect(evaluate({ limitOp: "plus_minus_pct", limitTolerance: "2.5", settingValue: "80" }, ["82"])).toBe("pass");
  });

  it("indeterminate: no nominal, no bound, a text limit, no limit, nothing present", () => {
    expect(evaluate({ limitOp: "plus_minus", limitTolerance: "3" }, ["1"])).toBeNull();
    expect(evaluate({ limitOp: "plus_minus_pct", limitNominal: "5" }, ["1"])).toBeNull();
    expect(evaluate({ limitOp: "lte" }, ["1"])).toBeNull();
    expect(evaluate({ limitOp: "between", limitLow: "1" }, ["1"])).toBeNull();
    expect(evaluate({ limitOp: "text" }, ["1"])).toBeNull();
    expect(evaluate({ limitOp: null }, ["1"])).toBeNull();
    expect(evaluate(lte, [null, undefined, "not_applicable", "1.000,5"])).toBeNull();
    expect(evaluate(lte, [])).toBeNull();
  });

  it("two readings: one failing fails; one missing evaluates the other", () => {
    expect(evaluate(lte, ["0.5", "0.8"])).toBe("fail");
    expect(evaluate(lte, ["0.5", null])).toBe("pass");
    expect(evaluate(lte, ["not_applicable", 0.6])).toBe("pass");
  });
});

describe("resolveTemplateVersion (§ 7.5)", () => {
  const base = { id: "base", deviceTypeId: null };
  const typed = { id: "typed", deviceTypeId: "t1" };

  it("the type's own, else the base's, else null", () => {
    expect(resolveTemplateVersion([base, typed], "t1")).toBe(typed);
    expect(resolveTemplateVersion([base, typed], "t2")).toBe(base);
    expect(resolveTemplateVersion([typed, base], null)).toBe(base);
    expect(resolveTemplateVersion([typed], undefined)).toBeNull();
    expect(resolveTemplateVersion([], "t1")).toBeNull();
  });
});

describe("an item's content: built and checked (§ 4.2, § 7.2)", () => {
  it("parses the limit, normalises the unit, reads the setting's number from its text", () => {
    expect(
      inspectionContentOf({
        section: "performance",
        label: "  Synthetic flow ",
        inputKind: "setting_measured_reference",
        unit: "lpm",
        settingText: " 5 ",
        limitText: "± 10%",
        validMin: "0",
        validMax: 20,
        warnMin: null,
        allowedOutcomes: ["pass", "fail"],
      }),
    ).toEqual({
      section: "performance",
      label: "Synthetic flow",
      inputKind: "setting_measured_reference",
      unit: "L/min",
      symbol: null,
      settingText: "5",
      settingValue: "5",
      limitOp: "plus_minus_pct",
      limitValue: null,
      limitLow: null,
      limitHigh: null,
      limitNominal: null,
      limitTolerance: "10",
      limitText: "± 10%",
      validMin: "0",
      validMax: "20",
      warnMin: null,
      warnMax: null,
      allowedOutcomes: ["pass", "fail"],
    });
    const plain = inspectionContentOf({ section: "function", label: "Check", inputKind: "tri_state", symbol: " S ", settingValue: "2,5" });
    expect(plain).toMatchObject({ limitOp: null, limitText: null, symbol: "S", settingValue: "2.5", settingText: null, allowedOutcomes: [] });
  });

  const ok: InspectionItemContent = inspectionContentOf({
    section: "electrical_safety",
    label: "Leak",
    inputKind: "measured_with_limit",
    unit: "µA",
    limitText: "≤ 100 µA",
    validMin: "0",
    validMax: "1000",
    warnMin: "0",
    warnMax: "500",
    allowedOutcomes: ["pass", "fail"],
  });

  it("a valid item has no problem", () => {
    expect(inspectionContentProblems(ok)).toEqual([]);
    expect(inspectionContentProblems(inspectionContentOf({ section: "environment", label: "T", inputKind: "measured", unit: "°C" }))).toEqual([]);
  });

  it("names each problem, in order", () => {
    expect(inspectionContentProblems({ ...ok, section: "function", allowedOutcomes: ["done"] })).toEqual([
      '"Leak": the function section takes tri_state items, not measured_with_limit.',
      '"Leak": done is not an outcome of the function section.',
    ]);
    expect(inspectionContentProblems({ ...ok, allowedOutcomes: [] })).toEqual(['"Leak": choose at least one allowed outcome.']);
    expect(inspectionContentProblems({ ...ok, section: "tools_used", inputKind: "text", unit: null, limitOp: null, limitText: null, allowedOutcomes: ["done"] })).toEqual([
      '"Leak": the tools_used section takes check items, not text.',
      '"Leak": a text item has no outcomes.',
    ]);
    expect(inspectionContentProblems({ ...ok, unit: null })).toEqual(['"Leak": a measured item needs its unit.']);
    expect(inspectionContentProblems({ ...ok, section: "other_safety", inputKind: "tri_state", unit: null, limitOp: "lte" })).toEqual([
      '"Leak": only a measured-with-limit or a setting/measured/reference item has a limit.',
    ]);
    expect(inspectionContentProblems({ ...ok, unit: "mA" })).toEqual(['"Leak": the limit is in µA but the item records mA.']);
    expect(inspectionContentProblems({ ...ok, validMin: "10", validMax: "5", warnMin: null, warnMax: null })).toEqual(['"Leak": the valid range\'s minimum is above its maximum.']);
    expect(inspectionContentProblems({ ...ok, warnMin: "600", warnMax: "550" })).toEqual(['"Leak": the warning range\'s minimum is above its maximum.']);
    expect(inspectionContentProblems({ ...ok, warnMin: "-1" })).toEqual(['"Leak": the warning range must lie inside the valid range.']);
    expect(inspectionContentProblems({ ...ok, warnMax: "1001" })).toEqual(['"Leak": the warning range must lie inside the valid range.']);
  });
});
