/**
 * P22-01 — the catalogue page's pure helpers: an item's content rebuilt as the API takes it, a
 * draft's items as the PUT takes them, items grouped in the section registry's order, and the
 * limit preview. The vocabularies and the parser are the shared contracts' (`inspectionValues`),
 * the same code the server runs, so the preview cannot disagree with what the server stores.
 */
import {
  INSPECTION_SECTION_RULES,
  INSPECTION_SECTIONS,
  inspectionContentOf,
  inspectionContentProblems,
  parseLimit,
  type InspectionInputKind,
  type InspectionOutcome,
  type InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import type { DraftItemInput, ItemContentBody, ItemDefinition, TemplateItem } from "@/api/services/ipmCatalogue.service";

export { INSPECTION_SECTIONS, INSPECTION_SECTION_RULES };
export type { InspectionInputKind, InspectionOutcome, InspectionSection };

/** The kinds that record a number, and so need a unit and may carry ranges. */
export const MEASURED_KINDS: readonly InspectionInputKind[] = ["measured", "measured_with_limit", "setting_measured_reference"];
/** The kinds that carry a limit (a reference value) written as text. */
export const LIMIT_KINDS: readonly InspectionInputKind[] = ["measured_with_limit", "setting_measured_reference"];

/** The content columns an item, a definition or a form shares. */
export interface ContentFields {
  section: InspectionSection;
  label: string;
  inputKind: InspectionInputKind;
  unit: string | null;
  symbol: string | null;
  settingText: string | null;
  settingValue: string | null;
  limitText: string | null;
  validMin: string | null;
  validMax: string | null;
  warnMin: string | null;
  warnMax: string | null;
  allowedOutcomes: readonly InspectionOutcome[];
}

const orNull = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/**
 * An item's content as the API takes it: a union on `inputKind`, carrying only the fields its kind
 * allows (the schema is strict), the limit as its TEXT (the server parses it again).
 *
 * @param f - the stored or edited content
 * @returns the request body's `content`
 */
export const contentBodyOf = (f: ContentFields): ItemContentBody => {
  const head = { section: f.section, label: f.label.trim(), symbol: orNull(f.symbol) };
  const outcomes = [...f.allowedOutcomes];
  const ranges = { validMin: orNull(f.validMin), validMax: orNull(f.validMax), warnMin: orNull(f.warnMin), warnMax: orNull(f.warnMax) };
  const unit = (f.unit ?? "").trim();
  switch (f.inputKind) {
    case "check":
      return { ...head, inputKind: "check", allowedOutcomes: outcomes };
    case "tri_state":
      return { ...head, inputKind: "tri_state", allowedOutcomes: outcomes };
    case "condition_clean":
      return { ...head, inputKind: "condition_clean", allowedOutcomes: outcomes };
    case "text":
      return { ...head, inputKind: "text" };
    case "measured":
      return { ...head, inputKind: "measured", unit, ...ranges, allowedOutcomes: outcomes };
    case "measured_with_limit":
      return { ...head, inputKind: "measured_with_limit", unit, limitText: orNull(f.limitText), ...ranges, allowedOutcomes: outcomes };
    case "setting_measured_reference":
      return {
        ...head,
        inputKind: "setting_measured_reference",
        unit,
        settingText: orNull(f.settingText),
        settingValue: orNull(f.settingValue),
        limitText: orNull(f.limitText),
        ...ranges,
        allowedOutcomes: outcomes,
      };
  }
};

/** What is wrong with the content, by the shared rules the server applies (empty: it may be saved). */
export const contentProblems = (f: ContentFields): string[] =>
  f.label.trim() === "" ? [] : inspectionContentProblems(inspectionContentOf(contentBodyOf(f)));

/** One row of the draft editor: the definition it is, whether it is required, its copied content. */
export interface DraftRow {
  itemDefinitionId: string;
  required: boolean;
  /** The draft's own copy (kept on save); null for an item added from the library, which the server copies. */
  content: ContentFields | null;
  /** What the editor shows. */
  shown: ContentFields;
}

/** The editor's rows of a draft's items, in read order. */
export const draftRowsOf = (items: readonly TemplateItem[]): DraftRow[] =>
  orderedItems(items).map((item) => ({ itemDefinitionId: item.itemDefinitionId, required: item.required, content: item, shown: item }));

/** A library definition as a new draft row (its content copied by the server on save). */
export const draftRowOfDefinition = (definition: ItemDefinition): DraftRow => ({
  itemDefinitionId: definition.id,
  required: definition.defaultRequired,
  content: null,
  shown: definition,
});

/**
 * The PUT body's items: in section order, each section in the editor's order (the array order is
 * the order inside each section). An item already in the draft sends its copy back, so a save never
 * replaces the draft's copy with a later library edit.
 */
export const draftItemsOf = (rows: readonly DraftRow[]): DraftItemInput[] =>
  groupBySection(rows, (r) => r.shown.section).flatMap(([, group]) =>
    group.map((row) =>
      row.content === null
        ? { itemDefinitionId: row.itemDefinitionId, required: row.required }
        : { itemDefinitionId: row.itemDefinitionId, required: row.required, content: contentBodyOf(row.content) },
    ),
  );

/** Moves the row at `index` one place up (-1) or down (+1) among the rows of its own section. */
export const moveInSection = (rows: readonly DraftRow[], index: number, direction: -1 | 1): DraftRow[] => {
  const row = rows[index];
  if (!row) return [...rows];
  const sameSection = rows.map((r, i) => [r, i] as const).filter(([r]) => r.shown.section === row.shown.section);
  const at = sameSection.findIndex(([, i]) => i === index);
  const other = sameSection[at + direction];
  if (!other) return [...rows];
  const next = [...rows];
  next[index] = other[0];
  next[other[1]] = row;
  return next;
};

const sectionRank = (section: InspectionSection): number => INSPECTION_SECTIONS.indexOf(section);

/** Items in read order: section registry order, base before type, then their sort order. */
export const orderedItems = <T extends Pick<TemplateItem, "section" | "origin" | "sortOrder">>(items: readonly T[]): T[] =>
  [...items].sort(
    (a, b) =>
      sectionRank(a.section) - sectionRank(b.section) ||
      (a.origin === b.origin ? 0 : a.origin === "base" ? -1 : 1) ||
      a.sortOrder - b.sortOrder,
  );

/** The items grouped by section, sections in registry order, items in their given order; empty sections left out. */
export const groupBySection = <T>(items: readonly T[], sectionOf: (item: T) => InspectionSection): [InspectionSection, T[]][] =>
  INSPECTION_SECTIONS.map((section) => [section, items.filter((i) => sectionOf(i) === section)] as [InspectionSection, T[]]).filter(
    ([, group]) => group.length > 0,
  );

/** How the server will read a limit as written: null for none, `text` when it is printed only. */
export const limitPreview = (text: string | null | undefined) => parseLimit(text);

/** The limit's structured form in symbols, for the preview (`≤ 0.5 mA`, `10 – 20 °C`, `5 ± 10 %`). */
export const limitSymbolic = (text: string | null | undefined): string | null => {
  const limit = parseLimit(text);
  if (!limit || limit.op === "text") return null;
  const unit = limit.unit ? ` ${limit.unit}` : "";
  switch (limit.op) {
    case "lt":
      return `< ${limit.value ?? ""}${unit}`;
    case "lte":
      return `≤ ${limit.value ?? ""}${unit}`;
    case "gt":
      return `> ${limit.value ?? ""}${unit}`;
    case "gte":
      return `≥ ${limit.value ?? ""}${unit}`;
    case "between":
      return `${limit.low ?? ""} – ${limit.high ?? ""}${unit}`;
    case "plus_minus":
      return `${limit.nominal === null ? "" : `${limit.nominal} `}± ${limit.tolerance ?? ""}${unit}`;
    case "plus_minus_pct":
      return `${limit.nominal === null ? "" : `${limit.nominal} `}± ${limit.tolerance ?? ""} %`;
  }
};
