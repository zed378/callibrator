/**
 * The inspection catalogue's vocabularies and its canonical content form (P19-01 spec § 5, § 7.6;
 * ADR-125 and its Amendment 1). Built by P20-03 (2026-10-07), with the tables they type.
 *
 * Each vocabulary is a frozen tuple in its database ENUM's order (the order is what `sync` and
 * migration 0112 create the type from, so it is part of the schema) and the union derived from
 * it — the `qmsValues.ts` pattern (ADR-097). The sections' order is also the capture and print
 * order (`docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 2.2), so `ORDER BY section` reads in report
 * order.
 *
 * `canonicalTemplateVersion` is the § 7.6 payload a published version's `content_hash` is the
 * SHA-256 of. It lives here, beside the vocabularies, so the backend (migration 0112's seed, and
 * the catalogue service of P21-01), the offline client (ADR-127) and the IPM report's `/verify`
 * (P19-06) build the same bytes. The hash itself is computed with each platform's own SHA-256:
 * this package imports no Node or DOM API.
 *
 * NOT here yet (P21-01, with the API that uses them): `parseDecimal`, `parseLimit`,
 * `normaliseUnit`, `evaluate`, `resolveTemplateVersion` and the request/response schemas of
 * `inspectionCatalogue.ts` (spec § 6, § 7.5, § 8.4).
 */

/** The checklist sections, in capture and print order (spec § 5.1). */
export const INSPECTION_SECTIONS = Object.freeze([
  "environment",
  "electrical_supply",
  "tools_used",
  "other_safety",
  "physical",
  "electrical_safety",
  "function",
  "completeness",
  "performance",
  "battery",
  "maintenance_task",
  "consumable",
] as const);
export type InspectionSection = (typeof INSPECTION_SECTIONS)[number];

/** What the technician enters for an item (spec § 5.2; ADR-125's list). */
export const INSPECTION_INPUT_KINDS = Object.freeze([
  "check",
  "tri_state",
  "condition_clean",
  "measured",
  "measured_with_limit",
  "setting_measured_reference",
  "text",
] as const);
export type InspectionInputKind = (typeof INSPECTION_INPUT_KINDS)[number];

/**
 * Every outcome a result may carry; each section allows its own subset (G-1: physical and
 * consumable are NOT pass / fail / not applicable).
 */
export const INSPECTION_OUTCOMES = Object.freeze([
  "pass",
  "fail",
  "not_applicable",
  "done",
  "not_done",
  "good",
  "minor_damage",
  "major_damage",
  "available",
  "not_available",
  "empty",
] as const);
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

/** The cleanliness half of a `condition_clean` answer. */
export const INSPECTION_CLEANLINESS = Object.freeze(["clean", "dirty"] as const);
export type InspectionCleanliness = (typeof INSPECTION_CLEANLINESS)[number];

/** A structured limit's operator (spec § 6.2); `text` is printed as written and never evaluated. */
export const INSPECTION_LIMIT_OPS = Object.freeze([
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
  "plus_minus",
  "plus_minus_pct",
  "text",
] as const);
export type InspectionLimitOp = (typeof INSPECTION_LIMIT_OPS)[number];

/** What a tenant's proposal asks for (spec § 4.6). */
export const TEMPLATE_PROPOSAL_KINDS = Object.freeze([
  "new_device_type",
  "add_items",
  "change_items",
  "retire_items",
] as const);
export type TemplateProposalKind = (typeof TEMPLATE_PROPOSAL_KINDS)[number];

/** Where a version's item came from: the base template, materialised at publish, or the type's own. */
export const TEMPLATE_ITEM_ORIGINS = Object.freeze(["base", "type"] as const);
export type TemplateItemOrigin = (typeof TEMPLATE_ITEM_ORIGINS)[number];

/** One section's rules: the input kinds it allows, its outcome set, and whether a session may add ad-hoc rows. */
export interface InspectionSectionRule {
  readonly inputKinds: readonly InspectionInputKind[];
  readonly outcomes: readonly InspectionOutcome[];
  readonly adHoc: boolean;
}

const rule = (
  inputKinds: readonly InspectionInputKind[],
  outcomes: readonly InspectionOutcome[],
  adHoc: boolean,
): InspectionSectionRule => Object.freeze({ inputKinds: Object.freeze([...inputKinds]), outcomes: Object.freeze([...outcomes]), adHoc });

const TRI_STATE: readonly InspectionOutcome[] = ["pass", "fail", "not_applicable"];
const CHECKED: readonly InspectionOutcome[] = ["done", "not_done"];
const PASS_FAIL: readonly InspectionOutcome[] = ["pass", "fail"];

/** The section registry (spec § 5.1), keyed in INSPECTION_SECTIONS order. */
export const INSPECTION_SECTION_RULES: Readonly<Record<InspectionSection, InspectionSectionRule>> = Object.freeze({
  environment: rule(["measured"], [], false),
  electrical_supply: rule(["measured"], ["not_applicable"], false),
  tools_used: rule(["check"], CHECKED, true),
  other_safety: rule(["tri_state"], TRI_STATE, false),
  physical: rule(["condition_clean"], ["good", "minor_damage", "major_damage"], false),
  electrical_safety: rule(["measured_with_limit"], TRI_STATE, true),
  function: rule(["tri_state"], TRI_STATE, false),
  completeness: rule(["tri_state"], TRI_STATE, false),
  performance: rule(["setting_measured_reference"], PASS_FAIL, true),
  battery: rule(["setting_measured_reference"], PASS_FAIL, false),
  maintenance_task: rule(["check"], CHECKED, false),
  consumable: rule(["tri_state"], ["available", "not_available", "empty"], true),
});

// ── The canonical content of a template version (spec § 7.6) ─────────────────

/** The version of the canonical form. A later form gets a new string; an old hash is never reinterpreted. */
export const TEMPLATE_VERSION_CANONICAL_SCHEMA = "inspection-template-version-v1";

/** A decimal as the database or a client may hold it: a string (PostgreSQL NUMERIC) or a finite number. */
export type DecimalInput = string | number | null;

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * The one spelling of a decimal in the canonical form: no sign on zero, no `+`, no leading zeros,
 * no trailing fractional zeros, `.` as the separator — so `"80"`, `"80.0"` (what NUMERIC returns
 * for a value written as 80.0) and `80` hash alike. NULL stays NULL.
 *
 * @throws {TypeError} on anything that is not a plain decimal (an exponent, NaN, Infinity, a comma):
 *   a canonical form must never hash a value it cannot read
 */
export const canonicalDecimal = (value: DecimalInput): string | null => {
  if (value === null) {
    return null;
  }
  const text = typeof value === "number" ? String(value) : value;
  const match = DECIMAL.exec(text);
  if (!match) {
    throw new TypeError(`Not a plain decimal: ${JSON.stringify(text)}`);
  }
  // match[2] is the mandatory digits group: always present when the pattern matched.
  const integer = String(match[2]).replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  return match[1] === "-" && magnitude !== "0" ? `-${magnitude}` : magnitude;
};

/** One item of a version, as the canonical form reads it (the § 4.5 columns, camelCase). */
export interface CanonicalTemplateItemInput {
  readonly id: string;
  readonly itemDefinitionId: string;
  readonly origin: TemplateItemOrigin;
  readonly section: InspectionSection;
  readonly label: string;
  readonly inputKind: InspectionInputKind;
  readonly unit: string | null;
  readonly symbol: string | null;
  readonly settingText: string | null;
  readonly settingValue: DecimalInput;
  readonly limitOp: InspectionLimitOp | null;
  readonly limitValue: DecimalInput;
  readonly limitLow: DecimalInput;
  readonly limitHigh: DecimalInput;
  readonly limitNominal: DecimalInput;
  readonly limitTolerance: DecimalInput;
  readonly limitText: string | null;
  readonly validMin: DecimalInput;
  readonly validMax: DecimalInput;
  readonly warnMin: DecimalInput;
  readonly warnMax: DecimalInput;
  readonly allowedOutcomes: readonly InspectionOutcome[];
  readonly required: boolean;
  readonly sortOrder: number;
}

/** A version, as the canonical form reads it. */
export interface CanonicalTemplateVersionInput {
  readonly templateId: string;
  /** NULL for the base template's versions. */
  readonly deviceTypeId: string | null;
  readonly versionNumber: number;
  /** The base version materialised into a type version; NULL on the base's own versions. */
  readonly baseVersionId: string | null;
  readonly items: readonly CanonicalTemplateItemInput[];
}

/** A JSON value the canonical serialiser writes. */
type Canonical = string | number | boolean | null | readonly Canonical[] | CanonicalObject;
/** A JSON object of canonical values (an interface: the type is recursive). */
interface CanonicalObject {
  readonly [key: string]: Canonical;
}

/** JSON with object keys sorted and no insignificant whitespace. Integers only: decimals travel as strings. */
const serialise = (value: Canonical): string => {
  if (Array.isArray(value)) {
    return `[${value.map(serialise).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as CanonicalObject;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialise(record[key] as Canonical)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError(`Not an integer: ${String(value)}`);
  }
  return JSON.stringify(value);
};

const sectionIndex = (section: InspectionSection): number => INSPECTION_SECTIONS.indexOf(section);
const originIndex = (origin: TemplateItemOrigin): number => TEMPLATE_ITEM_ORIGINS.indexOf(origin);

/** The read order (spec § 4.5, § 7.6): section registry order, base before type, sort_order, id. */
const readOrder = (a: CanonicalTemplateItemInput, b: CanonicalTemplateItemInput): number =>
  sectionIndex(a.section) - sectionIndex(b.section) ||
  originIndex(a.origin) - originIndex(b.origin) ||
  a.sortOrder - b.sortOrder ||
  Number(a.id > b.id) - Number(a.id < b.id);

const canonicalItem = (item: CanonicalTemplateItemInput): Canonical => ({
  id: item.id,
  itemDefinitionId: item.itemDefinitionId,
  origin: item.origin,
  section: item.section,
  label: item.label,
  inputKind: item.inputKind,
  unit: item.unit,
  symbol: item.symbol,
  settingText: item.settingText,
  settingValue: canonicalDecimal(item.settingValue),
  limitOp: item.limitOp,
  limitValue: canonicalDecimal(item.limitValue),
  limitLow: canonicalDecimal(item.limitLow),
  limitHigh: canonicalDecimal(item.limitHigh),
  limitNominal: canonicalDecimal(item.limitNominal),
  limitTolerance: canonicalDecimal(item.limitTolerance),
  limitText: item.limitText,
  validMin: canonicalDecimal(item.validMin),
  validMax: canonicalDecimal(item.validMax),
  warnMin: canonicalDecimal(item.warnMin),
  warnMax: canonicalDecimal(item.warnMax),
  allowedOutcomes: [...item.allowedOutcomes].sort(),
  required: item.required,
  sortOrder: item.sortOrder,
});

/**
 * The canonical text of a version (spec § 7.6): UTF-8 JSON, keys sorted, no insignificant
 * whitespace, decimals as `canonicalDecimal` strings, `allowedOutcomes` sorted, items in READ
 * order whatever order they are passed in (so two sides that fetched the rows differently agree;
 * moving an item changes its `sortOrder` or section, and so the text). Item ids are part of it:
 * results pin them. `content_hash` = lower-case hex SHA-256 of this text.
 */
export const canonicalTemplateVersion = (version: CanonicalTemplateVersionInput): string =>
  serialise({
    schema: TEMPLATE_VERSION_CANONICAL_SCHEMA,
    templateId: version.templateId,
    deviceTypeId: version.deviceTypeId,
    versionNumber: version.versionNumber,
    baseVersionId: version.baseVersionId,
    items: [...version.items].sort(readOrder).map(canonicalItem),
  });
