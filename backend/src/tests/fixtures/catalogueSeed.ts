/**
 * catalogueSeed — a synthetic inspection catalogue for memoryDb route tests (P21-01): the base
 * template with a published version 1 (as migration 0112 seeds it, with fewer items), a few
 * library definitions, and helpers to add a device type. Every value is synthetic (privacy rule):
 * labels like "Synthetic leakage check", numbers chosen for the test.
 */
import type { MemoryDb } from "./memoryDb";

export const BASE_TEMPLATE = "5eedca7a-0000-4000-8000-000000000001";
export const BASE_V1 = "5eedca7a-0000-4000-8000-000000000002";

/** Library definitions: two in the base, the rest for type checklists. */
export const DEF = Object.freeze({
  temperature: "dddd0000-0000-4000-8000-000000000001",
  placement: "dddd0000-0000-4000-8000-000000000002",
  leakage: "dddd0000-0000-4000-8000-000000000003",
  pressure: "dddd0000-0000-4000-8000-000000000004",
  power: "dddd0000-0000-4000-8000-000000000005",
  retired: "dddd0000-0000-4000-8000-000000000006",
  extraFunction: "dddd0000-0000-4000-8000-000000000007",
  extraSafety: "dddd0000-0000-4000-8000-000000000008",
});

const NULLS = {
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
  unit: null,
};

export const DEFINITION_ROWS: readonly Record<string, unknown>[] = Object.freeze([
  { id: DEF.temperature, ...NULLS, section: "environment", label: "Synthetic room temperature", inputKind: "measured", unit: "°C", validMin: "-20", validMax: "80", allowedOutcomes: [] },
  { id: DEF.placement, ...NULLS, section: "other_safety", label: "Synthetic placement", inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] },
  {
    id: DEF.leakage,
    ...NULLS,
    section: "electrical_safety",
    label: "Synthetic leakage check",
    inputKind: "measured_with_limit",
    unit: "µA",
    limitOp: "lte",
    limitValue: "100",
    limitText: "≤ 100 µA",
    allowedOutcomes: ["pass", "fail", "not_applicable"],
  },
  {
    id: DEF.pressure,
    ...NULLS,
    section: "performance",
    label: "Synthetic pressure reading",
    inputKind: "setting_measured_reference",
    unit: "mmHg",
    settingText: "120",
    settingValue: "120",
    limitOp: "plus_minus",
    limitTolerance: "3",
    limitText: "± 3 mmHg",
    allowedOutcomes: ["pass", "fail"],
  },
  { id: DEF.power, ...NULLS, section: "function", label: "Synthetic power-on check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] },
  { id: DEF.extraFunction, ...NULLS, section: "function", label: "Synthetic second function check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail"] },
  { id: DEF.extraSafety, ...NULLS, section: "other_safety", label: "Synthetic cable check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail"] },
  { id: DEF.retired, ...NULLS, section: "function", label: "Synthetic retired check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail"], status: "retired" },
]);

/** Base v1's item `n` of DEFINITION_ROWS: the definition's content, copied. */
const baseItem = (id: string, n: number): Record<string, unknown> => {
  const definition = DEFINITION_ROWS[n] as Record<string, unknown>;
  const content = Object.fromEntries(Object.entries(definition).filter(([k]) => k !== "id" && k !== "status"));
  return { ...content, id, versionId: BASE_V1, itemDefinitionId: definition["id"], origin: "base", required: true, sortOrder: 0 };
};

/** The base template, its published version 1 (two items) and the library. */
export const seedCatalogue = (mdb: MemoryDb): void => {
  mdb.seed(
    "InspectionItemDefinition",
    DEFINITION_ROWS.map((d) => ({ defaultRequired: true, status: "active", ...d })),
  );
  mdb.seed("InspectionTemplate", { id: BASE_TEMPLATE, deviceTypeId: null, status: "active" });
  mdb.seed("InspectionTemplateVersion", {
    id: BASE_V1,
    templateId: BASE_TEMPLATE,
    status: "published",
    versionNumber: 1,
    contentHash: "a".repeat(64),
    changeNote: "Synthetic base v1",
    revision: 0,
    publishedAt: new Date("2026-10-07T00:00:00Z"),
    publishedBySystem: "system:catalogue-seed",
  });
  mdb.seed("InspectionTemplateItem", [baseItem("5eed0000-0000-4000-8000-0000000000b1", 0), baseItem("5eed0000-0000-4000-8000-0000000000b2", 1)]);
};

/** A device type row. */
export const seedType = (mdb: MemoryDb, id: string, name: string, status: "active" | "retired" = "active"): void => {
  mdb.seed("DeviceType", { id, name, status });
};
