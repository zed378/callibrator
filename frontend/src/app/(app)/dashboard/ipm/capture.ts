/**
 * P22-03 — the IPM capture as plain data (P19-02 spec § 9.4; P19-01 § 5, § 6; F-35 … F-53): the
 * answers a technician gives, read back from a draft's results and written as the
 * `PUT …/results` body; each answer checked with the SAME pure rule the server applies
 * (`normaliseResult`), so a reading out of range or an overridden computed outcome is said on the
 * field, before the round trip; the steps (one section each); what a submit still misses
 * (`missingRequiredItems`, the server's own rule).
 */
import {
  AD_HOC_SECTIONS,
  type IpmResultInput,
} from "@callibrator/contracts/inspectionSessions";
import {
  INSPECTION_SECTIONS,
  INSPECTION_SECTION_RULES,
  missingRequiredItems,
  normaliseResult,
  type InspectionInputKind,
  type InspectionSection,
  type MissingItem,
  type NormaliseOutcome,
} from "@callibrator/contracts/inspectionValues";
import type { components } from "@/api/typed";

export type TemplateItem = components["schemas"]["InspectionTemplateItem"];
type Result = components["schemas"]["IpmResult"];
type Outcome = NonNullable<Result["outcome"]>;

/** One answer, as the fields hold it (text, so a decimal comma is kept as typed). */
export interface Answer {
  outcome: Outcome | null;
  cleanliness: "clean" | "dirty" | null;
  value: string;
  value1: string;
  value2: string;
  notApplicable: boolean;
  text: string;
}

export const EMPTY_ANSWER: Answer = { outcome: null, cleanliness: null, value: "", value1: "", value2: "", notApplicable: false, text: "" };

/** A row the technician added on site (F-39, F-42, F-45, F-49): its own label and, by kind, unit / setting / reference. */
export interface AdHocRow {
  key: string;
  section: InspectionSection;
  inputKind: InspectionInputKind;
  label: string;
  unit: string;
  settingText: string;
  referenceText: string;
  answer: Answer;
}

/** The capture's state: answers by template item id, and the ad-hoc rows in order. */
export interface CaptureState {
  answers: Record<string, Answer>;
  adHoc: AdHocRow[];
}

const answerOf = (r: Result): Answer => ({
  outcome: r.outcome === "not_applicable" && (r.inputKind === "measured" || r.inputKind === "measured_with_limit") ? null : r.outcome,
  cleanliness: r.cleanliness,
  value: r.measuredValue ?? "",
  value1: r.measuredValue1 ?? "",
  value2: r.measuredValue2 ?? "",
  notApplicable: r.outcome === "not_applicable" && (r.inputKind === "measured" || r.inputKind === "measured_with_limit"),
  text: r.textValue ?? "",
});

/** The state a draft's stored results read back as. */
export const stateFromResults = (results: readonly Result[]): CaptureState => ({
  answers: Object.fromEntries(results.filter((r) => r.templateItemId !== null).map((r) => [r.templateItemId as string, answerOf(r)])),
  adHoc: results
    .filter((r) => r.templateItemId === null)
    .map((r) => ({
      key: r.id,
      section: r.section,
      inputKind: r.inputKind,
      label: r.label,
      unit: r.unit ?? "",
      settingText: r.settingText ?? "",
      referenceText: r.referenceText ?? "",
      answer: answerOf(r),
    })),
});

/** Whether an answer holds anything (an empty one is not sent). */
export const isAnswered = (a: Answer): boolean =>
  a.outcome !== null || a.cleanliness !== null || a.value.trim() !== "" || a.value1.trim() !== "" || a.value2.trim() !== "" || a.notApplicable || a.text.trim() !== "";

const opt = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/** One answer in the contract's shape for its kind (the union `ipmResultInput`). */
const inputOf = (kind: InspectionInputKind, a: Answer, ref: { templateItemId: string } | { adHoc: NonNullable<IpmResultInput["adHoc"]> }): IpmResultInput => {
  switch (kind) {
    case "check":
      return { inputKind: "check", ...ref, outcome: a.outcome as "done" | "not_done" | null };
    case "tri_state":
      return { inputKind: "tri_state", ...ref, outcome: a.outcome };
    case "condition_clean":
      return { inputKind: "condition_clean", ...ref, outcome: a.outcome as "good" | "minor_damage" | "major_damage" | null, cleanliness: a.cleanliness };
    case "measured":
      return a.notApplicable ? { inputKind: "measured", ...ref, notApplicable: true } : { inputKind: "measured", ...ref, value: opt(a.value) };
    case "measured_with_limit":
      return a.notApplicable
        ? { inputKind: "measured_with_limit", ...ref, notApplicable: true }
        : { inputKind: "measured_with_limit", ...ref, value: opt(a.value), outcome: a.outcome as "pass" | "fail" | null };
    case "setting_measured_reference":
      return { inputKind: "setting_measured_reference", ...ref, value1: opt(a.value1), value2: opt(a.value2), outcome: a.outcome as "pass" | "fail" | null };
    case "text":
      return { inputKind: "text", ...ref, text: opt(a.text) };
  }
};

/** The `PUT …/results` rows: every answered template item, then every ad-hoc row with a label. */
export const resultInputs = (items: readonly TemplateItem[], state: CaptureState): IpmResultInput[] => [
  ...items.flatMap((item) => {
    const a = state.answers[item.id];
    return a && isAnswered(a) ? [inputOf(item.inputKind, a, { templateItemId: item.id })] : [];
  }),
  ...state.adHoc
    .filter((row) => row.label.trim() !== "")
    .map((row) =>
      inputOf(row.inputKind, row.answer, {
        adHoc: {
          section: row.section,
          label: row.label.trim(),
          ...(row.unit.trim() ? { unit: row.unit.trim() } : {}),
          ...(row.settingText.trim() ? { settingText: row.settingText.trim() } : {}),
          ...(row.referenceText.trim() ? { referenceText: row.referenceText.trim() } : {}),
        },
      }),
    ),
];

/** The server's rule on one answer: the stored row (its computed outcome, its flags) or the problem it would answer 400 with. */
export const checkAnswer = (item: TemplateItem | AdHocRow, a: Answer): NormaliseOutcome => {
  const isItem = "itemDefinitionId" in item;
  return normaliseResult(
    {
      section: item.section,
      label: item.label || "—",
      inputKind: item.inputKind,
      allowedOutcomes: isItem ? item.allowedOutcomes : [],
      limitOp: isItem ? item.limitOp : null,
      limitValue: isItem ? item.limitValue : null,
      limitLow: isItem ? item.limitLow : null,
      limitHigh: isItem ? item.limitHigh : null,
      limitNominal: isItem ? item.limitNominal : null,
      limitTolerance: isItem ? item.limitTolerance : null,
      settingValue: isItem ? item.settingValue : null,
      limitText: isItem ? item.limitText : null,
      validMin: isItem ? item.validMin : null,
      validMax: isItem ? item.validMax : null,
      warnMin: isItem ? item.warnMin : null,
      warnMax: isItem ? item.warnMax : null,
    },
    {
      inputKind: item.inputKind,
      outcome: a.outcome,
      cleanliness: a.cleanliness,
      value: opt(a.value),
      value1: opt(a.value1),
      value2: opt(a.value2),
      notApplicable: a.notApplicable,
      text: a.text,
    },
  );
};

/** The outcomes an item offers (its own list, else its section's). */
export const outcomesOf = (item: Pick<TemplateItem, "section" | "allowedOutcomes"> | Pick<AdHocRow, "section">): readonly string[] => {
  const own = "allowedOutcomes" in item ? item.allowedOutcomes : [];
  return own.length > 0 ? own : INSPECTION_SECTION_RULES[item.section].outcomes;
};

/** The steps: each section the checklist has items in, or that takes ad-hoc rows, in print order; then the header and the review. */
export type Step = { kind: "section"; section: InspectionSection } | { kind: "header" } | { kind: "review" };

export const stepsOf = (items: readonly TemplateItem[]): Step[] => [
  ...INSPECTION_SECTIONS.filter((s) => items.some((i) => i.section === s) || AD_HOC_SECTIONS.includes(s)).map((section) => ({ kind: "section" as const, section })),
  { kind: "header" },
  { kind: "review" },
];

/** The required items the answers do not complete (the submit's 400, said before it). */
export const missingOf = (items: readonly TemplateItem[], state: CaptureState): MissingItem[] =>
  missingRequiredItems(
    items,
    items.flatMap((item) => {
      const a = state.answers[item.id];
      if (!a) return [];
      const checked = checkAnswer(item, a);
      if (!checked.ok) return [];
      const r = checked.result;
      return [{ templateItemId: item.id, outcome: r.outcome, cleanliness: r.cleanliness, measuredValue: r.measuredValue, measuredValue1: r.measuredValue1, textValue: r.textValue }];
    }),
  );

/** The answers with a problem (they would make the save a 400): the first per row, by key. */
export const problemsOf = (items: readonly TemplateItem[], state: CaptureState): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const item of items) {
    const a = state.answers[item.id];
    if (!a || !isAnswered(a)) continue;
    const checked = checkAnswer(item, a);
    if (!checked.ok) out[item.id] = checked.problem;
  }
  for (const row of state.adHoc) {
    if (!isAnswered(row.answer)) continue;
    const checked = checkAnswer(row, row.answer);
    if (!checked.ok) out[row.key] = checked.problem;
  }
  return out;
};

/** A new ad-hoc row of a section (its kind is the section's first). */
export const newAdHoc = (section: InspectionSection, key: string): AdHocRow => ({
  key,
  section,
  inputKind: INSPECTION_SECTION_RULES[section].inputKinds[0] as InspectionInputKind,
  label: "",
  unit: "",
  settingText: "",
  referenceText: "",
  answer: { ...EMPTY_ANSWER },
});
