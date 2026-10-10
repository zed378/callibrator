/**
 * P22-03 — the capture's plain rules: a draft's results read back (a "not applicable" reading, an
 * ad-hoc row); the `PUT …/results` rows in the contract's shape for every kind (empty answers not
 * sent, ad-hoc rows only once named); each answer checked by the server's own rule (a reading
 * outside the possible range, an overridden computed outcome); the required items still missing;
 * the steps; a new ad-hoc row's kind.
 */
import { ipmResultsReplaceBody } from "@callibrator/contracts/inspectionSessions";
import {
  EMPTY_ANSWER,
  checkAnswer,
  isAnswered,
  missingOf,
  newAdHoc,
  outcomesOf,
  problemsOf,
  resultInputs,
  stateFromResults,
  stepsOf,
  type CaptureState,
  type TemplateItem,
} from "../capture";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const item = (n: number, over: Partial<TemplateItem>): TemplateItem => ({
  id: id(n),
  itemDefinitionId: id(100 + n),
  origin: "base",
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
  allowedOutcomes: [],
  required: true,
  sortOrder: n,
  ...over,
});

const ITEMS: TemplateItem[] = [
  item(1, { section: "environment", inputKind: "measured", unit: "°C", validMin: "-10", validMax: "60", warnMin: "10", warnMax: "45" }),
  item(2, { section: "electrical_supply", inputKind: "measured", allowedOutcomes: ["not_applicable"] }),
  item(3, { section: "tools_used", inputKind: "check" }),
  item(4, { section: "physical", inputKind: "condition_clean" }),
  item(5, { section: "electrical_safety", inputKind: "measured_with_limit", unit: "µA", limitOp: "lte", limitValue: "100", limitText: "≤ 100 µA" }),
  item(6, { section: "performance", inputKind: "setting_measured_reference", limitOp: "plus_minus", limitNominal: "10", limitTolerance: "1" }),
  item(7, { section: "function", inputKind: "tri_state" }),
  item(8, { section: "maintenance_task", inputKind: "text", required: false }),
];

const result = (over: Record<string, unknown>) => ({
  id: "r",
  section: "function",
  inputKind: "tri_state",
  templateItemId: null,
  itemDefinitionId: null,
  isAdHoc: false,
  label: "x",
  unit: null,
  symbol: null,
  settingText: null,
  referenceText: null,
  outcome: null,
  cleanliness: null,
  measuredValue: null,
  measuredValue1: null,
  measuredValue2: null,
  textValue: null,
  computedOutcome: null,
  outcomeSource: null,
  warnFlag: false,
  disagreementFlag: false,
  sortOrder: 0,
  ...over,
}) as Parameters<typeof stateFromResults>[0][number];

describe("P22-03 — capture rules", () => {
  it("a draft's results read back: answers by item, a 'not applicable' reading, an ad-hoc row with its own text", () => {
    const state = stateFromResults([
      result({ templateItemId: id(1), inputKind: "measured", measuredValue: "22.5" }),
      result({ templateItemId: id(2), inputKind: "measured", outcome: "not_applicable" }),
      result({ templateItemId: id(7), outcome: "pass" }),
      result({ id: "ah", section: "performance", inputKind: "setting_measured_reference", isAdHoc: true, label: "Flow", settingText: "10", referenceText: "10 ± 1", measuredValue1: "9.8", outcome: "pass", unit: "mL" }),
    ]);
    expect(state.answers[id(1)]).toEqual({ ...EMPTY_ANSWER, value: "22.5" });
    expect(state.answers[id(2)]).toEqual({ ...EMPTY_ANSWER, notApplicable: true });
    expect(state.answers[id(7)]?.outcome).toBe("pass");
    expect(state.adHoc).toEqual([
      { key: "ah", section: "performance", inputKind: "setting_measured_reference", label: "Flow", unit: "mL", settingText: "10", referenceText: "10 ± 1", answer: { ...EMPTY_ANSWER, value1: "9.8", outcome: "pass" } },
    ]);
  });

  it("the PUT rows: every kind in the contract's shape; empty answers and unnamed ad-hoc rows left out; the body passes the contract", () => {
    const state: CaptureState = {
      answers: {
        [id(1)]: { ...EMPTY_ANSWER, value: " 22,5 " },
        [id(2)]: { ...EMPTY_ANSWER, notApplicable: true },
        [id(3)]: { ...EMPTY_ANSWER, outcome: "done" },
        [id(4)]: { ...EMPTY_ANSWER, outcome: "good", cleanliness: "dirty" },
        [id(5)]: { ...EMPTY_ANSWER, value: "45" },
        [id(6)]: { ...EMPTY_ANSWER, value1: "10.2", value2: "", outcome: "pass" },
        [id(7)]: { ...EMPTY_ANSWER },
        [id(8)]: { ...EMPTY_ANSWER, text: " oiled " },
      },
      adHoc: [
        { ...newAdHoc("electrical_safety", "a"), label: " Leakage ", unit: "µA", answer: { ...EMPTY_ANSWER, notApplicable: true } },
        { ...newAdHoc("tools_used", "b"), label: "  " },
        { ...newAdHoc("performance", "c"), label: "Flow", settingText: "10", referenceText: "10 ± 1", answer: { ...EMPTY_ANSWER, value1: "9" } },
      ],
    };
    const rows = resultInputs(ITEMS, state);
    expect(rows).toEqual([
      { inputKind: "measured", templateItemId: id(1), value: "22,5" },
      { inputKind: "measured", templateItemId: id(2), notApplicable: true },
      { inputKind: "check", templateItemId: id(3), outcome: "done" },
      { inputKind: "condition_clean", templateItemId: id(4), outcome: "good", cleanliness: "dirty" },
      { inputKind: "measured_with_limit", templateItemId: id(5), value: "45", outcome: null },
      { inputKind: "setting_measured_reference", templateItemId: id(6), value1: "10.2", value2: null, outcome: "pass" },
      { inputKind: "text", templateItemId: id(8), text: "oiled" },
      { inputKind: "measured_with_limit", adHoc: { section: "electrical_safety", label: "Leakage", unit: "µA" }, notApplicable: true },
      { inputKind: "setting_measured_reference", adHoc: { section: "performance", label: "Flow", settingText: "10", referenceText: "10 ± 1" }, value1: "9", value2: null, outcome: null },
    ]);
    expect(ipmResultsReplaceBody.safeParse({ revision: 0, results: rows }).success).toBe(true);
    expect(isAnswered(EMPTY_ANSWER)).toBe(false);
  });

  it("the server's rule on a field: a reading out of range, a warning, a computed outcome that cannot be overridden", () => {
    const [env, , , , leak] = ITEMS as [TemplateItem, TemplateItem, TemplateItem, TemplateItem, TemplateItem];
    expect(checkAnswer(env, { ...EMPTY_ANSWER, value: "99" })).toMatchObject({ ok: false });
    expect(checkAnswer(env, { ...EMPTY_ANSWER, value: "50" })).toMatchObject({ ok: true, result: { warnFlag: true } });
    expect(checkAnswer(leak, { ...EMPTY_ANSWER, value: "45" })).toMatchObject({ ok: true, result: { computedOutcome: "pass", outcome: "pass" } });
    expect(checkAnswer(leak, { ...EMPTY_ANSWER, value: "450", outcome: "pass" })).toMatchObject({ ok: false });
    expect(checkAnswer(newAdHoc("consumable", "k"), { ...EMPTY_ANSWER, outcome: "empty" })).toMatchObject({ ok: true });
    const problems = problemsOf(ITEMS, {
      answers: { [id(1)]: { ...EMPTY_ANSWER, value: "1.000,5" }, [id(7)]: { ...EMPTY_ANSWER } },
      adHoc: [{ ...newAdHoc("electrical_safety", "x"), label: "L", answer: { ...EMPTY_ANSWER, value: "abc" } }],
    });
    expect(Object.keys(problems).sort()).toEqual([id(1), "x"].sort());
  });

  it("missing: the required items not yet answered, in print order (a refused answer counts as missing)", () => {
    const state: CaptureState = { answers: { [id(1)]: { ...EMPTY_ANSWER, value: "500" }, [id(7)]: { ...EMPTY_ANSWER, outcome: "pass" } }, adHoc: [] };
    expect(missingOf(ITEMS, state).map((m) => m.label)).toEqual(["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"]);
  });

  it("the steps: sections with items or taking ad-hoc rows, in print order, then the header and the review; outcomes per item", () => {
    const steps = stepsOf([item(1, { section: "battery" })]);
    expect(steps.map((s) => (s.kind === "section" ? s.section : s.kind))).toEqual(["tools_used", "electrical_safety", "performance", "battery", "consumable", "header", "review"]);
    expect(outcomesOf(item(1, { section: "function", allowedOutcomes: ["pass", "fail"] }))).toEqual(["pass", "fail"]);
    expect(outcomesOf(newAdHoc("consumable", "c"))).toEqual(["available", "not_available", "empty"]);
    expect(newAdHoc("tools_used", "t").inputKind).toBe("check");
  });
});
