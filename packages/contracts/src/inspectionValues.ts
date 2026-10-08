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
 * P21-01 (2026-10-09) adds the one parser and evaluator the server, the offline client and the
 * ETL share (spec § 6, § 7.5): `parseDecimal`, `normaliseUnit`, `parseLimit`, `evaluate`,
 * `resolveTemplateVersion`, and `inspectionContentProblems` (the publish-time checks of § 7.2).
 * The request/response schemas are `inspectionCatalogue.ts`.
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

/**
 * The IPM session's vocabularies (P20-04; P19-02 spec § 4; P19-06 spec § 4). Each is a frozen tuple
 * in its database ENUM's order (migration 0126 and `sync` create the types from it).
 */

/** A session's overall "Hasil Pemeriksaan" / "Hasil Maintenance", and a result's computed verdict. */
export const INSPECTION_OVERALL_OUTCOMES = Object.freeze(["pass", "fail"] as const);
export type InspectionOverallOutcome = (typeof INSPECTION_OVERALL_OUTCOMES)[number];

/** The recommendation that drives a submit's side effects (F-51; upstream 1 / 0 / −1 / −2). */
export const INSPECTION_RECOMMENDATIONS = Object.freeze([
  "fit_for_use",
  "needs_calibration",
  "not_fit_for_use",
  "needs_repair",
] as const);
export type InspectionRecommendation = (typeof INSPECTION_RECOMMENDATIONS)[number];

/** Whose verdict a result's `outcome` is: the technician's, or computed from the item's limit. */
export const INSPECTION_OUTCOME_SOURCES = Object.freeze(["technician", "computed"] as const);
export type InspectionOutcomeSource = (typeof INSPECTION_OUTCOME_SOURCES)[number];

/** An IPM report signature: the performer's, or the IPSRS countersignature (P19-06 § 4.2). */
export const INSPECTION_SIGNATURE_KINDS = Object.freeze(["performer", "countersign"] as const);
export type InspectionSignatureKind = (typeof INSPECTION_SIGNATURE_KINDS)[number];

/** The meaning printed with a signature (Part 11 § 11.50 (b)): performer = authorship, countersign = review. */
export const INSPECTION_SIGNATURE_MEANINGS = Object.freeze(["authorship", "review"] as const);
export type InspectionSignatureMeaning = (typeof INSPECTION_SIGNATURE_MEANINGS)[number];

/** The credential re-entered at signing. */
export const INSPECTION_SIGNATURE_AUTH_METHODS = Object.freeze(["password", "mfa"] as const);
export type InspectionSignatureAuthMethod = (typeof INSPECTION_SIGNATURE_AUTH_METHODS)[number];

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

// ── Parsing, units, limits and evaluation (spec § 6; P21-01) ─────────────────

/** What `parseDecimal` read: the canonical decimal, or null when the text is refused; and the text as given. */
export interface ParsedDecimal {
  readonly value: string | null;
  readonly raw: string;
}

/** One separator, `,` or `.`, read as the decimal point; no grouping, no exponent (spec § 6.1). */
const CAPTURED_DECIMAL = /^[+-]?\d+(?:[.,]\d+)?$/;

/**
 * A captured decimal (spec § 6.1): trimmed; `0,7` → `0.7`; the ambiguous `1.200` is one point two
 * (the form shows the parsed value back before submit); digit grouping (`1.000,5`, `1 000`) and
 * exponents are refused (`value` null, `raw` kept). A number is read through its string form.
 *
 * @param input - the text (or number) as entered
 * @returns the canonical decimal (`canonicalDecimal`) or null, and the raw text
 */
export const parseDecimal = (input: string | number | null | undefined): ParsedDecimal => {
  if (input === null || input === undefined) {
    return { value: null, raw: "" };
  }
  const raw = typeof input === "number" ? String(input) : input;
  const text = raw.trim();
  return { value: CAPTURED_DECIMAL.test(text) ? canonicalDecimal(text.replace(",", ".")) : null, raw };
};

/**
 * The closed alias table of spec § 6.3 (after the character folding of `normaliseUnit`). A new
 * alias is a contract change, never data.
 */
export const UNIT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  uA: "µA",
  ohm: "Ω",
  Ohm: "Ω",
  OHM: "Ω",
  mohm: "mΩ",
  kohm: "kΩ",
  Mohm: "MΩ",
  C: "°C",
  "%RH": "%",
  BPM: "bpm",
  Bpm: "bpm",
  lpm: "L/min",
  LPM: "L/min",
  "l/min": "L/min",
  ml: "mL",
  "ml/h": "mL/h",
});

/** Look-alike characters folded first: Greek mu → micro sign, ohm sign → Greek omega, ring / ordinal → degree. */
const FOLDS: readonly (readonly [RegExp, string])[] = [
  [/μ/g, "µ"],
  [/Ω/g, "Ω"],
  [/[˚º]/g, "°"],
];

/**
 * One unit token, normalised (spec § 6.3): look-alikes folded, then the alias table. An unknown
 * token is kept as written (trimmed, at most 20 characters — the column): still a valid label,
 * and a limit on it still evaluates (the same unit on both sides). There is no conversion.
 *
 * @param token - the unit as written
 * @returns the canonical unit, or null for none
 */
export const normaliseUnit = (token: string | null | undefined): string | null => {
  const folded = FOLDS.reduce((text, [pattern, to]) => text.replace(pattern, to), (token ?? "").trim());
  if (folded === "") {
    return null;
  }
  return (UNIT_ALIASES[folded] ?? folded).slice(0, 20);
};

/** A limit as `parseLimit` reads it — the structured columns of spec § 4.2. */
export interface ParsedLimit {
  readonly op: InspectionLimitOp;
  readonly value: string | null;
  readonly low: string | null;
  readonly high: string | null;
  readonly nominal: string | null;
  readonly tolerance: string | null;
  /** The limit's own unit, normalised; null when it names none, and for a percentage tolerance. */
  readonly unit: string | null;
  /** The limit as written (trimmed, whitespace collapsed, `˚` → `°`): what the report prints. */
  readonly text: string;
}

const NUM = String.raw`([+-]?\d+(?:[.,]\d+)?)`;
const UNSIGNED = String.raw`(\d+(?:[.,]\d+)?)`;
/** A unit: one token that does not start like a number. */
const UNIT = String.raw`(?:\s*([^\s\d+\-±.,][^\s]*))?`;
const PM = String.raw`(?:±|\+\/-|\+-)`;

const COMPARE = new RegExp(String.raw`^(≤|<=|<|≥|>=|>)\s*${NUM}${UNIT}$`, "u");
const MAXIMUM = new RegExp(String.raw`^(?:max|maks)\.?\s*${NUM}${UNIT}$`, "iu");
const MINIMUM = new RegExp(String.raw`^min\.?\s*${NUM}${UNIT}$`, "iu");
const PERCENT = new RegExp(String.raw`^${PM}\s*${UNSIGNED}\s*%$`, "u");
const ABSOLUTE = new RegExp(String.raw`^${PM}\s*${UNSIGNED}${UNIT}$`, "u");
const NOMINAL = new RegExp(String.raw`^${NUM}\s*${PM}\s*${UNSIGNED}(?:\s*(%)$|${UNIT}$)`, "u");
const BETWEEN = new RegExp(String.raw`^${NUM}\s*(?:-|–|s\.d\.|to)\s*${NUM}${UNIT}$`, "iu");

const COMPARATORS: Readonly<Record<string, InspectionLimitOp>> = Object.freeze({
  "≤": "lte",
  "<=": "lte",
  "<": "lt",
  "≥": "gte",
  ">=": "gte",
  ">": "gt",
});

// ── Exact decimal arithmetic on scaled integers (spec § 6.1, § 6.4) ──────────

/** A decimal as an integer and a count of fractional digits: `0.7` = 7 × 10⁻¹. */
interface Scaled {
  readonly digits: bigint;
  readonly scale: number;
}

const TEN = BigInt(10);
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

const pow10 = (n: number): bigint => {
  let result = BigInt(1);
  for (let i = 0; i < n; i += 1) {
    result *= TEN;
  }
  return result;
};

/** A decimal as a scaled integer, or null when it is absent or not a plain decimal. */
const scaledOf = (value: DecimalInput | undefined): Scaled | null => {
  const text = value === undefined ? null : parseDecimal(value).value;
  if (text === null) {
    return null;
  }
  const dot = text.indexOf(".");
  const fraction = dot < 0 ? "" : text.slice(dot + 1);
  return { digits: BigInt(`${dot < 0 ? text : text.slice(0, dot)}${fraction}`), scale: fraction.length };
};

/** `value`'s digits at `scale` (≥ its own). */
const at = (value: Scaled, scale: number): bigint => value.digits * pow10(scale - value.scale);

const abs = (n: bigint): bigint => (n < ZERO ? -n : n);

/** -1, 0 or 1 for `a` against `b`, exactly; null when either is absent or not a decimal. */
const compareScaled = (a: Scaled | null, b: Scaled | null): number | null => {
  if (!a || !b) {
    return null;
  }
  const scale = Math.max(a.scale, b.scale);
  const d = at(a, scale) - at(b, scale);
  return d < ZERO ? -1 : d > ZERO ? 1 : 0;
};

/** -1, 0 or 1; 0 when either side is absent (nothing to compare). */
const compareDecimals = (a: DecimalInput, b: DecimalInput): number => compareScaled(scaledOf(a), scaledOf(b)) ?? 0;

/** A NUM group the pattern matched: always a decimal parseDecimal accepts. */
const decimalOf = (text: string | undefined): string | null => parseDecimal(text).value;

/**
 * A reference value or limit as written → its structured form (spec § 6.2). Anything outside the
 * grammar is `{ op: "text" }`: printed as written and never evaluated (fail-closed: a person
 * decides). A range whose low end is above its high end is `text` too.
 *
 * @param input - the limit text
 * @returns the limit, or null for no limit (empty)
 */
export const parseLimit = (input: string | null | undefined): ParsedLimit | null => {
  const text = (input ?? "").replace(/[˚º]/g, "°").replace(/\s+/g, " ").trim();
  if (text === "") {
    return null;
  }
  const none = { value: null, low: null, high: null, nominal: null, tolerance: null, unit: null, text };
  let m = COMPARE.exec(text);
  if (m) {
    return { ...none, op: COMPARATORS[m[1] as string] as InspectionLimitOp, value: decimalOf(m[2]), unit: normaliseUnit(m[3]) };
  }
  m = MAXIMUM.exec(text) ?? MINIMUM.exec(text);
  if (m) {
    return { ...none, op: /^min/i.test(text) ? "gte" : "lte", value: decimalOf(m[1]), unit: normaliseUnit(m[2]) };
  }
  m = PERCENT.exec(text);
  if (m) {
    return { ...none, op: "plus_minus_pct", tolerance: decimalOf(m[1]) };
  }
  m = ABSOLUTE.exec(text);
  if (m) {
    return { ...none, op: "plus_minus", tolerance: decimalOf(m[1]), unit: normaliseUnit(m[2]) };
  }
  m = NOMINAL.exec(text);
  if (m) {
    const pct = m[3] === "%";
    return {
      ...none,
      op: pct ? "plus_minus_pct" : "plus_minus",
      nominal: decimalOf(m[1]),
      tolerance: decimalOf(m[2]),
      unit: pct ? null : normaliseUnit(m[4]),
    };
  }
  m = BETWEEN.exec(text);
  if (m) {
    const low = decimalOf(m[1]);
    const high = decimalOf(m[2]);
    if (compareDecimals(low, high) <= 0) {
      return { ...none, op: "between", low, high, unit: normaliseUnit(m[3]) };
    }
  }
  return { ...none, op: "text" };
};

/** The limit columns `evaluate` reads (an item definition or a template item). */
export interface EvaluableItem {
  readonly limitOp: InspectionLimitOp | null;
  readonly limitValue?: DecimalInput | undefined;
  readonly limitLow?: DecimalInput | undefined;
  readonly limitHigh?: DecimalInput | undefined;
  readonly limitNominal?: DecimalInput | undefined;
  readonly limitTolerance?: DecimalInput | undefined;
  /** The nominal of a tolerance when the limit names none. */
  readonly settingValue?: DecimalInput | undefined;
}

/** One reading: a decimal, or absent, or `not_applicable`. */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- `DecimalInput` admits any string; the outcome a reading may carry instead of a number is spelt out for the reader
export type InspectionReading = DecimalInput | "not_applicable" | undefined;

type Determinate = "pass" | "fail";

const verdict = (ok: boolean): Determinate => (ok ? "pass" : "fail");

/** One present reading against the limit; null when the limit cannot be evaluated. */
const evaluateOne = (item: EvaluableItem, m: Scaled): Determinate | null => {
  switch (item.limitOp) {
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const c = compareScaled(m, scaledOf(item.limitValue));
      return c === null ? null : verdict({ lt: c < 0, lte: c <= 0, gt: c > 0, gte: c >= 0 }[item.limitOp]);
    }
    case "between": {
      const low = compareScaled(m, scaledOf(item.limitLow));
      const high = compareScaled(m, scaledOf(item.limitHigh));
      return low === null || high === null ? null : verdict(low >= 0 && high <= 0);
    }
    case "plus_minus":
    case "plus_minus_pct": {
      const nominal = scaledOf(item.limitNominal ?? item.settingValue);
      const tolerance = scaledOf(item.limitTolerance);
      if (!nominal || !tolerance) {
        return null;
      }
      const scale = Math.max(m.scale, nominal.scale, tolerance.scale);
      const deviation = abs(at(m, scale) - at(nominal, scale));
      return item.limitOp === "plus_minus"
        ? verdict(deviation <= at(tolerance, scale))
        : // |m − n| ≤ |n| × t / 100, on integers at `scale`: |M − N| × 100 × 10^scale ≤ |N| × T.
          verdict(deviation * HUNDRED * pow10(scale) <= abs(at(nominal, scale)) * at(tolerance, scale));
    }
    case "text":
    case null:
      // Printed as written, or no limit: indeterminate — a person decides (spec § 6.4).
      return null;
  }
};

/**
 * The computed outcome of an item's readings (spec § 6.4): `fail` if any present reading fails,
 * `pass` if every present reading passes and at least one is present, else null (indeterminate).
 * A reading that is absent, `not_applicable` or not a plain decimal is not present. Boundaries are
 * inclusive for `≤`, `≥`, `between` and `±`; all arithmetic is on scaled integers.
 *
 * @param item - the limit columns (and the setting, the default nominal)
 * @param readings - reading 1 and, for a setting/measured/reference item, reading 2
 * @returns pass, fail or null
 */
export const evaluate = (item: EvaluableItem, readings: readonly InspectionReading[]): Determinate | null => {
  const outcomes = readings
    .map((reading) => (reading === "not_applicable" ? null : scaledOf(reading)))
    .filter((reading): reading is Scaled => reading !== null)
    .map((reading) => evaluateOne(item, reading));
  if (outcomes.includes("fail")) {
    return "fail";
  }
  return outcomes.length > 0 && outcomes.every((o) => o === "pass") ? "pass" : null;
};

/** The one thing `resolveTemplateVersion` reads of a published version. */
export interface PublishedVersionRef {
  /** NULL for the base template's version. */
  readonly deviceTypeId: string | null;
}

/**
 * Which published version a new session pins (spec § 7.5): the device type's own; else (no type,
 * no template, a retired template) the base's; else null — the caller answers 409 "No published
 * checklist exists". Pure, so the offline client resolves exactly as the server (ADR-127).
 *
 * @param published - the published versions (one per active template, at most)
 * @param deviceTypeId - the device's type, if any
 * @returns the version to pin, or null
 */
export const resolveTemplateVersion = <V extends PublishedVersionRef>(
  published: readonly V[],
  deviceTypeId: string | null | undefined,
): V | null =>
  (deviceTypeId ? published.find((v) => v.deviceTypeId === deviceTypeId) : undefined) ??
  published.find((v) => v.deviceTypeId === null) ??
  null;

// ── An item's content, built and checked (spec § 4.2, § 7.2) ─────────────────

/** The content columns of a definition or a template item (spec § 4.2), decimals as canonical strings. */
export interface InspectionItemContent {
  readonly section: InspectionSection;
  readonly label: string;
  readonly inputKind: InspectionInputKind;
  readonly unit: string | null;
  readonly symbol: string | null;
  readonly settingText: string | null;
  readonly settingValue: string | null;
  readonly limitOp: InspectionLimitOp | null;
  readonly limitValue: string | null;
  readonly limitLow: string | null;
  readonly limitHigh: string | null;
  readonly limitNominal: string | null;
  readonly limitTolerance: string | null;
  readonly limitText: string | null;
  readonly validMin: string | null;
  readonly validMax: string | null;
  readonly warnMin: string | null;
  readonly warnMax: string | null;
  readonly allowedOutcomes: readonly InspectionOutcome[];
}

/** What an operator writes for an item: the limit as TEXT (the server parses it), decimals as entered. */
export interface InspectionItemContentInput {
  readonly section: InspectionSection;
  readonly label: string;
  readonly inputKind: InspectionInputKind;
  readonly unit?: string | null | undefined;
  readonly symbol?: string | null | undefined;
  readonly settingText?: string | null | undefined;
  readonly settingValue?: DecimalInput | undefined;
  readonly limitText?: string | null | undefined;
  readonly validMin?: DecimalInput | undefined;
  readonly validMax?: DecimalInput | undefined;
  readonly warnMin?: DecimalInput | undefined;
  readonly warnMax?: DecimalInput | undefined;
  readonly allowedOutcomes?: readonly InspectionOutcome[] | undefined;
}

const textOrNull = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

/**
 * The stored content of an item: the unit normalised, the limit parsed from its text (spec § 6.2),
 * the setting's number read from its text when it spells one (§ 4.2), decimals canonical.
 *
 * @param input - what the operator wrote
 * @returns the 19 content columns
 */
export const inspectionContentOf = (input: InspectionItemContentInput): InspectionItemContent => {
  const limit = parseLimit(input.limitText);
  const settingText = textOrNull(input.settingText);
  return {
    section: input.section,
    label: input.label.trim(),
    inputKind: input.inputKind,
    unit: normaliseUnit(input.unit),
    symbol: textOrNull(input.symbol),
    settingText,
    settingValue: parseDecimal(input.settingValue ?? settingText).value,
    limitOp: limit?.op ?? null,
    limitValue: limit?.value ?? null,
    limitLow: limit?.low ?? null,
    limitHigh: limit?.high ?? null,
    limitNominal: limit?.nominal ?? null,
    limitTolerance: limit?.tolerance ?? null,
    limitText: limit?.text ?? null,
    validMin: parseDecimal(input.validMin).value,
    validMax: parseDecimal(input.validMax).value,
    warnMin: parseDecimal(input.warnMin).value,
    warnMax: parseDecimal(input.warnMax).value,
    allowedOutcomes: [...(input.allowedOutcomes ?? [])],
  };
};

const MEASURED_KINDS: readonly InspectionInputKind[] = ["measured", "measured_with_limit", "setting_measured_reference"];
const LIMIT_KINDS: readonly InspectionInputKind[] = ["measured_with_limit", "setting_measured_reference"];

/**
 * What is wrong with an item's content (spec § 4.2's CHECKs, § 5.1, § 6.2's unit rule, § 7.2's
 * publish refusals) — one sentence each, empty when it may be stored and published. Run by the
 * request schemas (a 400 before the service) and again at publish over every item.
 *
 * @param content - the stored form (`inspectionContentOf`)
 * @returns the problems, in a fixed order
 */
export const inspectionContentProblems = (content: InspectionItemContent): string[] => {
  const problems: string[] = [];
  const rule = INSPECTION_SECTION_RULES[content.section];
  const where = `"${content.label}"`;
  if (!rule.inputKinds.includes(content.inputKind)) {
    problems.push(`${where}: the ${content.section} section takes ${rule.inputKinds.join(", ")} items, not ${content.inputKind}.`);
  }
  const outside = content.allowedOutcomes.filter((o) => !rule.outcomes.includes(o));
  if (outside.length > 0) {
    problems.push(`${where}: ${outside.join(", ")} is not an outcome of the ${content.section} section.`);
  }
  if (content.allowedOutcomes.length === 0 && content.inputKind !== "measured" && content.inputKind !== "text") {
    problems.push(`${where}: choose at least one allowed outcome.`);
  }
  if (content.inputKind === "text" && content.allowedOutcomes.length > 0) {
    problems.push(`${where}: a text item has no outcomes.`);
  }
  if (MEASURED_KINDS.includes(content.inputKind) && content.unit === null) {
    problems.push(`${where}: a measured item needs its unit.`);
  }
  if (content.limitOp !== null && !LIMIT_KINDS.includes(content.inputKind)) {
    problems.push(`${where}: only a measured-with-limit or a setting/measured/reference item has a limit.`);
  }
  const limitUnit = parseLimit(content.limitText)?.unit ?? null;
  if (limitUnit !== null && content.unit !== null && limitUnit !== content.unit) {
    problems.push(`${where}: the limit is in ${limitUnit} but the item records ${content.unit}.`);
  }
  if (compareDecimals(content.validMin, content.validMax) > 0) {
    problems.push(`${where}: the valid range's minimum is above its maximum.`);
  }
  if (compareDecimals(content.warnMin, content.warnMax) > 0) {
    problems.push(`${where}: the warning range's minimum is above its maximum.`);
  }
  if (compareDecimals(content.warnMin, content.validMin) < 0 || compareDecimals(content.warnMax, content.validMax) > 0) {
    problems.push(`${where}: the warning range must lie inside the valid range.`);
  }
  return problems;
};

// ── IPM sessions: conflict codes and one result's normal form (P21-03; P19-02 spec § 7, § 9.4) ──

/**
 * The machine-readable codes of an IPM session's 409s (P19-02 spec § 7; ADR-127 § 8). Each travels
 * in the TOP-LEVEL `code` of the answer, beside its explanation, so the offline outbox shows the
 * server's reason for every "needs attention" item. Frozen; the order is the spec's.
 */
export const IPM_CONFLICT_CODES = Object.freeze([
  "IPM_DEVICE_RETIRED",
  "IPM_DEVICE_INACTIVE",
  "IPM_FACILITY_ENDED",
  "IPM_VERSION_RETIRED",
  "IPM_VERSION_STALE",
  "IPM_NO_CHECKLIST",
  "IPM_DRAFT_EXISTS",
  "IPM_CLIENT_REF_REUSED",
  "IPM_REVISION_CONFLICT",
  "IPM_NOT_DRAFT",
  "IPM_NOT_SUBMITTED",
  "IPM_VOIDED",
  "IPM_SUPERSEDED",
  "IPM_CORRECTION_OPEN",
  "IPM_ORIGINAL_NOT_EFFECTIVE",
  // P21-04 (P19-06 spec § 13): the report and its signatures.
  "IPM_ALREADY_SIGNED",
  "IPM_ALREADY_COUNTERSIGNED",
  "IPM_REPORT_NOT_SIGNED",
  "IPM_COUNTERSIGN_DISABLED",
  "IPM_REPORT_IMPORTED",
  "IPM_REPORT_INTEGRITY",
] as const);
export type IpmConflictCode = (typeof IPM_CONFLICT_CODES)[number];

/** The `Idempotency-Key` middleware's 409 codes (P19-02 spec § 9.2; AM-25). */
export const IDEMPOTENCY_CONFLICT_CODES = Object.freeze([
  "IDEMPOTENCY_IN_FLIGHT",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_SCOPE_CHANGED",
] as const);
export type IdempotencyConflictCode = (typeof IDEMPOTENCY_CONFLICT_CODES)[number];

/** At most this many result rows in one session: 300 template rows + 100 ad-hoc rows (spec § 4.2). */
export const IPM_MAX_RESULTS = 400;
/** At most this many ad-hoc rows in one session (spec § 4.2). */
export const IPM_MAX_AD_HOC_RESULTS = 100;

/** What `normaliseResult` reads of the item a result answers: a pinned template item, or an ad-hoc row's section. */
export interface NormalisableItem extends EvaluableItem {
  readonly section: InspectionSection;
  readonly label: string;
  readonly inputKind: InspectionInputKind;
  readonly limitText?: string | null | undefined;
  readonly validMin?: DecimalInput | undefined;
  readonly validMax?: DecimalInput | undefined;
  readonly warnMin?: DecimalInput | undefined;
  readonly warnMax?: DecimalInput | undefined;
  /** Empty: the section's outcomes. */
  readonly allowedOutcomes: readonly InspectionOutcome[];
}

/**
 * What a technician sent for one item (the `ipmResultInput` contract's values). A draft may be
 * incomplete, so every value is optional; which ones a kind accepts is the contract's union.
 * `value` is the reading of `measured` / `measured_with_limit`; `value1` / `value2` the two
 * readings of `setting_measured_reference` (ADR-126 Am. 4 § 3).
 */
export interface IpmResultValues {
  readonly inputKind: InspectionInputKind;
  readonly outcome?: InspectionOutcome | null | undefined;
  readonly cleanliness?: InspectionCleanliness | null | undefined;
  readonly value?: DecimalInput | undefined;
  readonly value1?: DecimalInput | undefined;
  readonly value2?: DecimalInput | undefined;
  readonly notApplicable?: boolean | undefined;
  readonly text?: string | null | undefined;
}

/** The stored columns of one result, as the server writes them (spec § 4.2). */
export interface NormalisedResult {
  readonly outcome: InspectionOutcome | null;
  readonly cleanliness: InspectionCleanliness | null;
  readonly measuredValue: string | null;
  readonly measuredValue1: string | null;
  readonly measuredValue2: string | null;
  readonly textValue: string | null;
  readonly computedOutcome: InspectionOverallOutcome | null;
  readonly outcomeSource: InspectionOutcomeSource | null;
  readonly warnFlag: boolean;
  readonly disagreementFlag: boolean;
}

/** `normaliseResult`'s answer: the row, or the one problem the 400 names. */
export type NormaliseOutcome = { readonly ok: true; readonly result: NormalisedResult } | { readonly ok: false; readonly problem: string };

/** One reading against the item's hard and warning ranges. */
type Reading = { readonly ok: true; readonly value: string | null; readonly warn: boolean } | { readonly ok: false; readonly problem: string };

const NO_READING: Reading = Object.freeze({ ok: true, value: null, warn: false });

const outsideOf = (bound: DecimalInput | undefined, op: "gte" | "lte", value: string): boolean =>
  bound !== null && bound !== undefined && evaluate({ limitOp: op, limitValue: bound }, [value]) === "fail";

const readingOf = (item: NormalisableItem, input: DecimalInput | undefined): Reading => {
  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) {
    return NO_READING;
  }
  const parsed = parseDecimal(input);
  if (parsed.value === null) {
    return { ok: false, problem: `The value of "${item.label}" (${parsed.raw}) is not a number: write one decimal separator and no digit grouping.` };
  }
  if (outsideOf(item.validMin, "gte", parsed.value) || outsideOf(item.validMax, "lte", parsed.value)) {
    const range = `${String(item.validMin ?? "…")} – ${String(item.validMax ?? "…")}`;
    return { ok: false, problem: `"${item.label}": ${parsed.value} is outside the possible range (${range}); check the reading.` };
  }
  return { ok: true, value: parsed.value, warn: outsideOf(item.warnMin, "gte", parsed.value) || outsideOf(item.warnMax, "lte", parsed.value) };
};

const EMPTY_RESULT: NormalisedResult = Object.freeze({
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
});

/**
 * One result, checked against the item it answers and put in its stored form (P19-02 spec § 9.4;
 * P19-01 § 5.2, § 6). The item is the SERVER's copy (the pinned version's, or the ad-hoc row's
 * section): labels, limits and kinds are never taken from the client. Pure, so the offline client
 * shows the same 400 before it syncs.
 *
 *  - the kind must be the item's; an outcome must be one the item (else its section) allows;
 *  - a reading is a decimal (`parseDecimal`: grouping refused), inside `valid_min/max` (else the
 *    400), and outside `warn_min/max` sets `warnFlag`;
 *  - `measured_with_limit`: a determinate computed outcome IS the outcome — a different one sent
 *    is refused ("re-measure instead of overriding it"); indeterminate → the technician's choice;
 *  - `setting_measured_reference`: the technician's outcome, the computed one beside it, and
 *    `disagreementFlag` when both are known and differ;
 *  - `not_applicable` only where the item allows it, and then with no reading.
 *
 * A draft may be incomplete: an absent value stays NULL (the submit checks completeness).
 *
 * @param item - the item, as the server holds it
 * @param input - the values sent
 * @returns the stored columns, or the problem
 */
export const normaliseResult = (item: NormalisableItem, input: IpmResultValues): NormaliseOutcome => {
  if (input.inputKind !== item.inputKind) {
    return { ok: false, problem: `"${item.label}" is a ${item.inputKind} item, not ${input.inputKind}.` };
  }
  const allowed = item.allowedOutcomes.length > 0 ? item.allowedOutcomes : INSPECTION_SECTION_RULES[item.section].outcomes;
  const outcome = input.outcome ?? null;
  if (outcome !== null && !allowed.includes(outcome)) {
    return { ok: false, problem: `"${item.label}" cannot be answered "${outcome}"; choose one of: ${allowed.join(", ")}.` };
  }
  const notApplicable = input.notApplicable === true;
  if (notApplicable && !allowed.includes("not_applicable")) {
    return { ok: false, problem: `"${item.label}" cannot be marked not applicable.` };
  }
  const chosen = { outcome, outcomeSource: outcome === null ? null : ("technician" as const) };
  switch (item.inputKind) {
    case "check":
    case "tri_state":
      return { ok: true, result: { ...EMPTY_RESULT, ...chosen } };
    case "condition_clean":
      return { ok: true, result: { ...EMPTY_RESULT, ...chosen, cleanliness: input.cleanliness ?? null } };
    case "text": {
      const text = input.text?.trim() ?? "";
      return { ok: true, result: { ...EMPTY_RESULT, textValue: text === "" ? null : text } };
    }
    case "measured":
    case "measured_with_limit": {
      if (notApplicable) {
        return { ok: true, result: { ...EMPTY_RESULT, outcome: "not_applicable", outcomeSource: "technician" } };
      }
      const reading = readingOf(item, input.value);
      if (!reading.ok) {
        return reading;
      }
      if (item.inputKind === "measured") {
        return { ok: true, result: { ...EMPTY_RESULT, measuredValue: reading.value, warnFlag: reading.warn } };
      }
      const computed = reading.value === null ? null : evaluate(item, [reading.value]);
      if (computed !== null && outcome !== null && outcome !== computed) {
        return {
          ok: false,
          problem: `The result of "${item.label}" is computed from its limit (${item.limitText ?? "its limit"}): ${computed}. Re-measure instead of overriding it.`,
        };
      }
      const base = { ...EMPTY_RESULT, measuredValue: reading.value, warnFlag: reading.warn, computedOutcome: computed };
      return { ok: true, result: computed === null ? { ...base, ...chosen } : { ...base, outcome: computed, outcomeSource: "computed" } };
    }
    case "setting_measured_reference": {
      const first = readingOf(item, input.value1);
      if (!first.ok) {
        return first;
      }
      const second = readingOf(item, input.value2);
      if (!second.ok) {
        return second;
      }
      const readings = [first.value, second.value].filter((v): v is string => v !== null);
      const computed = readings.length === 0 ? null : evaluate(item, readings);
      return {
        ok: true,
        result: {
          ...EMPTY_RESULT,
          ...chosen,
          measuredValue1: first.value,
          measuredValue2: second.value,
          warnFlag: first.warn || second.warn,
          computedOutcome: computed,
          disagreementFlag: computed !== null && outcome !== null && computed !== outcome,
        },
      };
    }
  }
};

// ── IPM submit completeness and "due" (P21-04; P19-02 spec § 7.2, § 11) ──────

/** A pinned template item, as the completeness check reads it. */
export interface RequirableItem {
  readonly id: string;
  readonly section: InspectionSection;
  readonly label: string;
  readonly inputKind: InspectionInputKind;
  readonly required: boolean;
}

/** A stored result, as the completeness check reads it. */
export interface AnsweredResult {
  readonly templateItemId: string | null;
  readonly outcome: string | null;
  readonly cleanliness?: string | null | undefined;
  readonly measuredValue: string | null;
  readonly measuredValue1: string | null;
  readonly textValue: string | null;
}

/** One required item a submit still misses. */
export interface MissingItem {
  readonly section: InspectionSection;
  readonly label: string;
}

/**
 * Whether a result answers its item (the submit's rule; a draft may hold a partial row):
 *  - `check`, `tri_state`: an outcome;
 *  - `condition_clean`: an outcome AND the cleanliness (`09` L-3 prints both);
 *  - `measured`, `measured_with_limit`: a reading, or "not applicable";
 *  - `setting_measured_reference`: the first reading AND the technician's outcome;
 *  - `text`: a text.
 */
const answers = (kind: InspectionInputKind, r: AnsweredResult): boolean => {
  switch (kind) {
    case "check":
    case "tri_state":
      return r.outcome !== null;
    case "condition_clean":
      return r.outcome !== null && (r.cleanliness ?? null) !== null;
    case "measured":
    case "measured_with_limit":
      return r.measuredValue !== null || r.outcome === "not_applicable";
    case "setting_measured_reference":
      return r.measuredValue1 !== null && r.outcome !== null;
    case "text":
      return r.textValue !== null;
  }
};

/**
 * The REQUIRED items of the pinned version that the results do not answer, in print order
 * (section, then the items' order as given) — the 400 of a submit lists them by section and label
 * (P19-02 spec § 7.2). Pure: the offline client shows the same list before it syncs.
 *
 * @param items - the pinned version's items, in read order
 * @param results - the draft's results
 * @returns the missing items (empty when the draft is complete)
 */
export const missingRequiredItems = (items: readonly RequirableItem[], results: readonly AnsweredResult[]): MissingItem[] => {
  const byItem = new Map(results.flatMap((r) => (r.templateItemId === null ? [] : [[r.templateItemId, r] as const])));
  return items
    .filter((item) => {
      if (!item.required) {
        return false;
      }
      const result = byItem.get(item.id);
      return result === undefined || !answers(item.inputKind, result);
    })
    .map((item) => ({ section: item.section, label: item.label }))
    .sort((a, b) => INSPECTION_SECTIONS.indexOf(a.section) - INSPECTION_SECTIONS.indexOf(b.section));
};

/** A date's calendar parts in an IANA time zone. */
export interface ZonedDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * The calendar day of an instant in a time zone (the report number's day, "due"'s month).
 *
 * @param at - the instant
 * @param timeZone - an IANA zone (e.g. `Asia/Jakarta`)
 * @returns year, month (1 – 12) and day
 */
export const zonedDay = (at: Date, timeZone: string): ZonedDay => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part: Readonly<Record<string, string>> = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(part["year"]), month: Number(part["month"]), day: Number(part["day"]) };
};

/** `YYYYMMDD` of a zoned day (the report number's day). */
export const compactDay = (d: ZonedDay): string => `${String(d.year)}${String(d.month).padStart(2, "0")}${String(d.day).padStart(2, "0")}`;

/** Whether `timeZone` is an IANA zone this runtime knows. */
export const isTimeZone = (timeZone: string): boolean => {
  try {
    return Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
};

/** The time zone of a tenant that set none (P19-02 spec § 4.3). */
export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

/** The states "due" answers (P19-02 spec § 11). */
export const IPM_DUE_STATES = Object.freeze(["not_scheduled", "never_inspected", "due", "ok"] as const);
export type IpmDueState = (typeof IPM_DUE_STATES)[number];

/** What `computeIpmDue` reads of one device. */
export interface IpmDueInput {
  /** The device's status; `retired`, `inactive` or a deleted device is never scheduled. */
  readonly status: string | null;
  readonly deleted?: boolean | undefined;
  /** `calibration_devices.ipm_interval_months`: 0 = not under IPM, null = the tenant's. */
  readonly intervalOverride: number | null;
  /** The tenant setting `ipm_interval_months` (null = not scheduled). */
  readonly tenantInterval: number | null;
  /** The newest EFFECTIVE session's `performed_at` (submitted, not superseded), or null. */
  readonly lastEffectivePerformedAt: Date | null;
  readonly today: Date;
  readonly timeZone: string;
}

/** "Due", as every reader shows it. */
export type IpmDue =
  | { readonly state: "not_scheduled" }
  | { readonly state: "never_inspected"; readonly intervalMonths: number }
  | { readonly state: "due" | "ok"; readonly dueMonth: string; readonly lastPerformedAt: string; readonly intervalMonths: number };

const monthIndex = (d: ZonedDay): number => d.year * 12 + (d.month - 1);
const monthText = (index: number): string => `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;

/**
 * "Due" (ADR-126 § 6; P19-02 spec § 11): computed at read, never enforced. A device is due in the
 * month of its last effective IPM (tenant zone) plus its interval; a device never inspected under
 * a schedule counts as due. The server is authoritative; the PWA shows the same.
 *
 * @param input - the device, the tenant's interval and zone, and today
 * @returns the state
 */
export const computeIpmDue = (input: IpmDueInput): IpmDue => {
  if (input.deleted === true || input.status === "retired" || input.status === "inactive") {
    return { state: "not_scheduled" };
  }
  const interval = input.intervalOverride ?? input.tenantInterval;
  if (interval === null || interval <= 0) {
    return { state: "not_scheduled" };
  }
  if (input.lastEffectivePerformedAt === null) {
    return { state: "never_inspected", intervalMonths: interval };
  }
  const due = monthIndex(zonedDay(input.lastEffectivePerformedAt, input.timeZone)) + interval;
  return {
    state: due <= monthIndex(zonedDay(input.today, input.timeZone)) ? "due" : "ok",
    dueMonth: monthText(due),
    lastPerformedAt: input.lastEffectivePerformedAt.toISOString(),
    intervalMonths: interval,
  };
};
