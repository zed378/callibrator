/**
 * P20-03 (ADR-125 Amendment 1; spec MEMORY/specs/P19-01-inspection-catalogue.md § 5, § 7.6) —
 * the catalogue's vocabularies, its section registry, and the canonical text a published
 * version's `content_hash` is the SHA-256 of.
 *
 * The expectations are the spec's tables, written out here by hand — not read back from the
 * module under test (CLAUDE.md, Evidence): a vocabulary reordered, or a canonical form that
 * changed, fails. A changed canonical form would silently change every hash a deployment has
 * stored (migration 0112's base version 1 among them), so the text is pinned byte for byte.
 */
import { createHash } from "node:crypto";
import {
  INSPECTION_CLEANLINESS,
  INSPECTION_INPUT_KINDS,
  INSPECTION_LIMIT_OPS,
  INSPECTION_OUTCOMES,
  INSPECTION_SECTIONS,
  INSPECTION_SECTION_RULES,
  TEMPLATE_ITEM_ORIGINS,
  TEMPLATE_PROPOSAL_KINDS,
  TEMPLATE_VERSION_CANONICAL_SCHEMA,
  canonicalDecimal,
  canonicalTemplateVersion,
  type CanonicalTemplateItemInput,
} from "@callibrator/contracts/inspectionValues";
import {
  CATALOGUE_LIFECYCLE_STATUSES,
  DEVICE_TYPE_STATUSES,
  INSPECTION_ITEM_DEFINITION_STATUSES,
  INSPECTION_TEMPLATE_STATUSES,
  TEMPLATE_PROPOSAL_STATUSES,
  TEMPLATE_VERSION_STATUSES,
} from "@callibrator/contracts/states";

const TEMPLATE = "a2003000-0000-4000-8000-000000000001";
const DEFINITION_A = "a2003000-0000-4000-8000-0000000000d1";
const DEFINITION_B = "a2003000-0000-4000-8000-0000000000d2";
const ITEM_A = "a2003000-0000-4000-8000-0000000000a1";
const ITEM_B = "a2003000-0000-4000-8000-0000000000a2";

/** A synthetic item (no upstream text): every field present, as the canonical form reads it. */
const item = (overrides: Partial<CanonicalTemplateItemInput>): CanonicalTemplateItemInput => ({
  id: ITEM_A,
  itemDefinitionId: DEFINITION_A,
  origin: "type",
  section: "electrical_safety",
  label: "Synthetic leakage check",
  inputKind: "measured_with_limit",
  unit: "µA",
  symbol: null,
  settingText: null,
  settingValue: null,
  limitOp: "lte",
  limitValue: "100",
  limitLow: null,
  limitHigh: null,
  limitNominal: null,
  limitTolerance: null,
  limitText: "≤ 100 µA",
  validMin: "0",
  validMax: null,
  warnMin: null,
  warnMax: null,
  allowedOutcomes: ["pass", "fail"],
  required: true,
  sortOrder: 0,
  ...overrides,
});

const version = (items: readonly CanonicalTemplateItemInput[]) => ({
  templateId: TEMPLATE,
  deviceTypeId: null,
  versionNumber: 3,
  baseVersionId: null,
  items,
});

describe("P20-03 — the catalogue vocabularies (spec § 5), in their ENUM order", () => {
  it("sections are the twelve of § 5.1, in capture and print order", () => {
    expect(INSPECTION_SECTIONS).toEqual([
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
    ]);
  });

  it("input kinds, outcomes, cleanliness, limit operators, proposal kinds and item origins", () => {
    expect(INSPECTION_INPUT_KINDS).toEqual([
      "check",
      "tri_state",
      "condition_clean",
      "measured",
      "measured_with_limit",
      "setting_measured_reference",
      "text",
    ]);
    expect(INSPECTION_OUTCOMES).toEqual([
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
    ]);
    expect(INSPECTION_CLEANLINESS).toEqual(["clean", "dirty"]);
    expect(INSPECTION_LIMIT_OPS).toEqual(["lt", "lte", "gt", "gte", "between", "plus_minus", "plus_minus_pct", "text"]);
    expect(TEMPLATE_PROPOSAL_KINDS).toEqual(["new_device_type", "add_items", "change_items", "retire_items"]);
    expect(TEMPLATE_ITEM_ORIGINS).toEqual(["base", "type"]);
  });

  it("the state tuples (§ 7): one active ⇄ retired lifecycle shared by types, definitions and templates", () => {
    expect(CATALOGUE_LIFECYCLE_STATUSES).toEqual(["active", "retired"]);
    expect(DEVICE_TYPE_STATUSES).toBe(CATALOGUE_LIFECYCLE_STATUSES);
    expect(INSPECTION_ITEM_DEFINITION_STATUSES).toBe(CATALOGUE_LIFECYCLE_STATUSES);
    expect(INSPECTION_TEMPLATE_STATUSES).toBe(CATALOGUE_LIFECYCLE_STATUSES);
    expect(TEMPLATE_VERSION_STATUSES).toEqual(["draft", "published", "retired", "discarded"]);
    expect(TEMPLATE_PROPOSAL_STATUSES).toEqual(["submitted", "accepted", "rejected", "withdrawn"]);
  });

  it("every tuple and the registry are frozen", () => {
    for (const tuple of [
      INSPECTION_SECTIONS,
      INSPECTION_INPUT_KINDS,
      INSPECTION_OUTCOMES,
      INSPECTION_CLEANLINESS,
      INSPECTION_LIMIT_OPS,
      TEMPLATE_PROPOSAL_KINDS,
      TEMPLATE_ITEM_ORIGINS,
      CATALOGUE_LIFECYCLE_STATUSES,
      TEMPLATE_VERSION_STATUSES,
      TEMPLATE_PROPOSAL_STATUSES,
    ]) {
      expect(Object.isFrozen(tuple)).toBe(true);
    }
    expect(Object.isFrozen(INSPECTION_SECTION_RULES)).toBe(true);
    expect(Object.isFrozen(INSPECTION_SECTION_RULES.physical)).toBe(true);
    expect(Object.isFrozen(INSPECTION_SECTION_RULES.physical.outcomes)).toBe(true);
  });
});

describe("P20-03 — the section registry (spec § 5.1)", () => {
  it("names every section once, in INSPECTION_SECTIONS order", () => {
    expect(Object.keys(INSPECTION_SECTION_RULES)).toEqual([...INSPECTION_SECTIONS]);
  });

  it("holds the § 5.1 table: kinds, outcome set and ad-hoc rows per section (G-1: physical and consumable)", () => {
    const table = Object.fromEntries(
      Object.entries(INSPECTION_SECTION_RULES).map(([section, rule]) => [
        section,
        `${rule.inputKinds.join("|")} / ${rule.outcomes.join("|") || "—"} / ${rule.adHoc ? "ad-hoc" : "fixed"}`,
      ]),
    );
    expect(table).toEqual({
      environment: "measured / — / fixed",
      electrical_supply: "measured / not_applicable / fixed",
      tools_used: "check / done|not_done / ad-hoc",
      other_safety: "tri_state / pass|fail|not_applicable / fixed",
      physical: "condition_clean / good|minor_damage|major_damage / fixed",
      electrical_safety: "measured_with_limit / pass|fail|not_applicable / ad-hoc",
      function: "tri_state / pass|fail|not_applicable / fixed",
      completeness: "tri_state / pass|fail|not_applicable / fixed",
      performance: "setting_measured_reference / pass|fail / ad-hoc",
      battery: "setting_measured_reference / pass|fail / fixed",
      maintenance_task: "check / done|not_done / fixed",
      consumable: "tri_state / available|not_available|empty / ad-hoc",
    });
  });

  it("every kind and outcome a rule names is in its vocabulary", () => {
    for (const rule of Object.values(INSPECTION_SECTION_RULES)) {
      for (const kind of rule.inputKinds) {
        expect(INSPECTION_INPUT_KINDS).toContain(kind);
      }
      for (const outcome of rule.outcomes) {
        expect(INSPECTION_OUTCOMES).toContain(outcome);
      }
    }
  });
});

describe("P20-03 — canonicalDecimal: one spelling per value (spec § 7.6)", () => {
  it.each([
    ["80", "80"],
    ["80.0", "80"],
    ["80.50", "80.5"],
    ["0.7", "0.7"],
    ["000.70", "0.7"],
    ["+12", "12"],
    ["-3.50", "-3.5"],
    ["-0", "0"],
    ["-0.000", "0"],
    ["0", "0"],
    ["0.7000001", "0.7000001"],
  ])("%j → %j", (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected);
  });

  it("numbers read as their decimal text; NULL stays NULL", () => {
    expect(canonicalDecimal(242)).toBe("242");
    expect(canonicalDecimal(-20)).toBe("-20");
    expect(canonicalDecimal(0.5)).toBe("0.5");
    expect(canonicalDecimal(null)).toBeNull();
  });

  it.each([["1e-7"], ["NaN"], ["Infinity"], ["0,7"], ["1.000,5"], [""], [" 1"], ["1."], [".5"]])(
    "refuses %j — a canonical form never hashes a value it cannot read",
    (input) => {
      expect(() => canonicalDecimal(input)).toThrow(TypeError);
    },
  );

  it("refuses a number that only prints with an exponent", () => {
    expect(() => canonicalDecimal(1e-7)).toThrow(/Not a plain decimal/);
  });
});

describe("P20-03 — canonicalTemplateVersion (spec § 7.6)", () => {
  it("is the pinned text: keys sorted, no whitespace, decimals as strings, outcomes sorted", () => {
    expect(canonicalTemplateVersion(version([item({ allowedOutcomes: ["fail", "pass"], limitValue: "100.00" })]))).toBe(
      `{"baseVersionId":null,"deviceTypeId":null,"items":[{"allowedOutcomes":["fail","pass"],"id":"${ITEM_A}",` +
        `"inputKind":"measured_with_limit","itemDefinitionId":"${DEFINITION_A}","label":"Synthetic leakage check",` +
        `"limitHigh":null,"limitLow":null,"limitNominal":null,"limitOp":"lte","limitText":"≤ 100 µA",` +
        `"limitTolerance":null,"limitValue":"100","origin":"type","required":true,"section":"electrical_safety",` +
        `"settingText":null,"settingValue":null,"sortOrder":0,"symbol":null,"unit":"µA","validMax":null,` +
        `"validMin":"0","warnMax":null,"warnMin":null}],"schema":"${TEMPLATE_VERSION_CANONICAL_SCHEMA}",` +
        `"templateId":"${TEMPLATE}","versionNumber":3}`,
    );
    expect(TEMPLATE_VERSION_CANONICAL_SCHEMA).toBe("inspection-template-version-v1");
  });

  it("does not depend on the order the rows were fetched in, nor on the outcome order", () => {
    const a = item({});
    const b = item({ id: ITEM_B, itemDefinitionId: DEFINITION_B, sortOrder: 1, label: "Synthetic check B" });
    expect(canonicalTemplateVersion(version([a, b]))).toBe(canonicalTemplateVersion(version([b, a])));
    expect(canonicalTemplateVersion(version([item({ allowedOutcomes: ["pass", "fail"] })]))).toBe(
      canonicalTemplateVersion(version([item({ allowedOutcomes: ["fail", "pass"] })])),
    );
  });

  it("reads items in READ order: section registry order, base before type, sort_order, id", () => {
    const performance = item({ id: "p", section: "performance", sortOrder: 0 });
    const environment = item({ id: "e", section: "environment", sortOrder: 9 });
    const typeFirst = item({ id: "t", section: "function", origin: "type", sortOrder: 0 });
    const baseSecond = item({ id: "b", section: "function", origin: "base", sortOrder: 5 });
    const lowId = item({ id: "1", section: "battery", sortOrder: 2 });
    const highId = item({ id: "2", section: "battery", sortOrder: 2 });
    const text = canonicalTemplateVersion(version([performance, highId, typeFirst, lowId, environment, baseSecond]));
    const ids = [...text.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["e", "b", "t", "p", "1", "2"]);
  });

  it("changes when an item moves, its content changes, or the version's identity changes", () => {
    const a = item({});
    const b = item({ id: ITEM_B, itemDefinitionId: DEFINITION_B, sortOrder: 1 });
    const base = canonicalTemplateVersion(version([a, b]));
    const moved = canonicalTemplateVersion(version([{ ...a, sortOrder: 1 }, { ...b, sortOrder: 0 }]));
    expect(moved).not.toBe(base);
    expect(canonicalTemplateVersion(version([{ ...a, limitValue: "101" }, b]))).not.toBe(base);
    expect(canonicalTemplateVersion({ ...version([a, b]), versionNumber: 4 })).not.toBe(base);
    expect(canonicalTemplateVersion({ ...version([a, b]), baseVersionId: TEMPLATE })).not.toBe(base);
  });

  it("80, 80.0 and the number 80 hash alike", () => {
    const hash = (value: string | number): string =>
      createHash("sha256").update(canonicalTemplateVersion(version([item({ validMax: value })])), "utf8").digest("hex");
    expect(hash("80.0")).toBe(hash("80"));
    expect(hash(80)).toBe(hash("80"));
  });

  it("two identical rows (the same id twice) still serialise deterministically", () => {
    const twice = canonicalTemplateVersion(version([item({}), item({})]));
    expect([...twice.matchAll(/"id":"/g)]).toHaveLength(2);
  });

  it("refuses a version number that is not an integer", () => {
    expect(() => canonicalTemplateVersion({ ...version([]), versionNumber: 1.5 })).toThrow(/Not an integer/);
  });
});
