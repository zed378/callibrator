/**
 * P22-10c2 — the capture's answers read back from the `ipmResultInput` rows the engine keeps (the
 * inverse of P22-03's `resultInputs`, so the same rows are re-sent byte for byte when nothing
 * changed). Loaded with the capture screen only (it reaches zod through the IPM contracts).
 */
import type { IpmResultInput } from "@callibrator/contracts/inspectionSessions";
import { INSPECTION_SECTIONS } from "@callibrator/contracts/inspectionValues";
import { EMPTY_ANSWER, type AdHocRow, type Answer, type CaptureState } from "@/app/(app)/dashboard/ipm/capture";
import type { CatalogueItem, PublishedVersion } from "./checklist";

/** A version's items in print order (section order, then the item's own order). */
export const sortedItems = (version: PublishedVersion): CatalogueItem[] =>
  [...version.items].sort((a, b) => INSPECTION_SECTIONS.indexOf(a.section) - INSPECTION_SECTIONS.indexOf(b.section) || a.sortOrder - b.sortOrder);

type Row = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : "");

const answerOf = (r: Row): Answer => ({
  ...EMPTY_ANSWER,
  outcome: (typeof r["outcome"] === "string" ? r["outcome"] : null) as Answer["outcome"],
  cleanliness: (r["cleanliness"] === "clean" || r["cleanliness"] === "dirty" ? r["cleanliness"] : null) as Answer["cleanliness"],
  value: text(r["value"]),
  value1: text(r["value1"]),
  value2: text(r["value2"]),
  notApplicable: r["notApplicable"] === true,
  text: text(r["text"]),
});

/** The capture's answers from the stored `ipmResultInput` rows. */
export const stateFromInputs = (inputs: readonly unknown[]): CaptureState => {
  const state: CaptureState = { answers: {}, adHoc: [] };
  inputs.forEach((input, i) => {
    const r = (input ?? {}) as Row & Partial<IpmResultInput>;
    if (typeof r["templateItemId"] === "string") {
      state.answers[r["templateItemId"]] = answerOf(r);
      return;
    }
    const adHoc = (r["adHoc"] ?? {}) as Row;
    const row: AdHocRow = {
      key: `row-${String(i)}`,
      section: adHoc["section"] as AdHocRow["section"],
      inputKind: r["inputKind"] as AdHocRow["inputKind"],
      label: text(adHoc["label"]),
      unit: text(adHoc["unit"]),
      settingText: text(adHoc["settingText"]),
      referenceText: text(adHoc["referenceText"]),
      answer: answerOf(r),
    };
    state.adHoc.push(row);
  });
  return state;
};
