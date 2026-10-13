/**
 * P24-02d — the transform's templates step (services/upstreamImport/transform/templates.ts) over a
 * statement double: the references a mapping row names, who owns a template, the fingerprint, the
 * plan in every branch (create, next version, unchanged, duplicates merged, the operator's checklist
 * left alone, unresolved rows quarantined), and what the step sends. The same statements run on
 * PostgreSQL 18 in migrations/upstreamTransform.p2402d.live.
 *
 * Synthetic values only.
 */
import { createHash } from "crypto";
import type { Transaction } from "sequelize";
import { canonicalTemplateVersion, type CanonicalTemplateItemInput } from "@callibrator/contracts/inspectionValues";
import { TRANSFORM_STEPS, type StepContext } from "../../../services/upstreamImport/transform/steps";
import {
  IMPORT_CHANGE_NOTE,
  TEMPLATE_SOURCES,
  TEMPLATE_TABLES,
  fingerprintOf,
  itemReferenceOf,
  planTemplates,
  runTemplates,
  transformOwns,
  typeReferenceOf,
  type ItemContent,
  type StagedTemplateRow,
  type TemplateInput,
  type TemplateState,
} from "../../../services/upstreamImport/transform/templates";
import { TransformFailure } from "../../../services/upstreamImport/transform/failure";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const RUN = "a2402000-0000-4000-8000-0000000000f4";
const TX = { id: "tx" } as unknown as Transaction;
const TYPE_A = "a2402000-0000-4000-8000-0000000000c1";
const TYPE_B = "a2402000-0000-4000-8000-0000000000c2";
const DEF_F1 = "a2402000-0000-4000-8000-0000000000d1";
const DEF_F2 = "a2402000-0000-4000-8000-0000000000d2";
const DEF_K1 = "a2402000-0000-4000-8000-0000000000d3";
const BASE_VERSION = "a2402000-0000-4000-8000-0000000000b1";
const BASE_DEF = "a2402000-0000-4000-8000-0000000000b2";
const BASE_ITEM = "a2402000-0000-4000-8000-0000000000b3";

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

const double = (rules: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    query: (text: string, options: SqlQueryOptions) => {
      const call = { text, bind: options.bind ?? [], transaction: options.transaction };
      calls.push(call);
      const rule = rules.find(([pattern]) => pattern.test(text));
      return Promise.resolve(rule ? rule[1](call) : []);
    },
  };
};

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX, tenantId: "a2402000-0000-4000-8000-0000000000a1", sourceZone: "UTC" });

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

const content = (section: ItemContent["section"], label: string): ItemContent => ({
  section,
  label,
  inputKind: section === "performance" ? "measured" : "tri_state",
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
  allowedOutcomes: section === "performance" ? [] : ["pass", "fail", "not_applicable"],
  required: true,
});

const BASE_ITEMS: CanonicalTemplateItemInput[] = [
  { ...content("environment", "Suhu ruang"), inputKind: "measured", allowedOutcomes: [], id: BASE_ITEM, itemDefinitionId: BASE_DEF, origin: "base", sortOrder: 0 },
];

const CONTENT = new Map<string, ItemContent>([
  [DEF_F1, content("function", "Fungsi satu")],
  [DEF_F2, content("function", "Fungsi dua")],
  [DEF_K1, content("completeness", "Kabel daya")],
]);

const staged = (table: string, legacyId: string, row: Record<string, unknown>, values: Partial<StagedTemplateRow> = {}): StagedTemplateRow => ({
  table,
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "e"),
  targetId: null,
  decision: "new",
  row,
  ...values,
});

const fungsi = (legacyId: string, type: string, item: string, values: Partial<StagedTemplateRow> = {}): StagedTemplateRow =>
  staged("mapping_fugsi_alat", legacyId, { id: legacyId, id_alat: type, id_pemeriksaan_fungsi_alat: item }, values);
const kelengkapan = (legacyId: string, type: string, item: string, values: Partial<StagedTemplateRow> = {}): StagedTemplateRow =>
  staged("mapping_kelengkapan_alat", legacyId, { id: legacyId, id_alat: type, id_kelengkapan_alat: item }, values);

const input = (rows: StagedTemplateRow[], extra: Partial<TemplateInput> = {}): TemplateInput => ({
  rows,
  types: new Map([["7", TYPE_A], ["8", TYPE_B]]),
  definitions: new Map([
    ["mst_pemeriksaan_fungsi_alat:1", DEF_F1],
    ["mst_pemeriksaan_fungsi_alat:2", DEF_F2],
    ["mst_kelengkapan_alat:1", DEF_K1],
  ]),
  content: CONTENT,
  templates: new Map(),
  publishedItems: new Map(),
  base: { versionId: BASE_VERSION, items: BASE_ITEMS },
  newId: ids(),
  ...extra,
});

const state = (values: Partial<TemplateState> = {}): TemplateState => ({
  templateId: "a2402000-0000-4000-8000-0000000000e1",
  deviceTypeId: TYPE_A,
  status: "active",
  publishedId: null,
  publishedBaseId: null,
  maxNumber: null,
  draftOpen: false,
  lastAuthor: null,
  ...values,
});

describe("P24-02d the registry", () => {
  it("step 5 is built over the five mapping tables, each keyed by its id and pointing into its checklist", () => {
    expect(TRANSFORM_STEPS.find((s) => s.id === "inspection_templates")).toMatchObject({ run: runTemplates, sources: TEMPLATE_SOURCES });
    expect(TEMPLATE_SOURCES.map((s) => s.table)).toEqual(Object.keys(TEMPLATE_TABLES));
    expect(TEMPLATE_SOURCES.every((s) => s.legacyId === 's."id"::text')).toBe(true);
    expect(Object.values(TEMPLATE_TABLES)).toEqual([
      "mst_pemeriksaan_fungsi_alat",
      "mst_alat_kerja_digunakan",
      "mst_pemeriksaan_keamanan_listrik",
      "mst_kelengkapan_alat",
      "mst_pemeriksaan_kinerja_alat",
    ]);
  });
});

describe("P24-02d references", () => {
  it("the item is the one id_* column besides id_alat, a positive integer; anything else is no reference", () => {
    expect(itemReferenceOf({ id: "1", id_alat: "7", id_kelengkapan_alat: " 12 " })).toBe("12");
    expect(itemReferenceOf({ id_alat: 7, id_kinerja_alat: 3 })).toBe("3");
    expect(itemReferenceOf({ id: "1", id_alat: "7" })).toBeNull();
    expect(itemReferenceOf({ id_alat: "7", id_a: "1", id_b: "2" })).toBeNull();
    expect(itemReferenceOf({ id_alat: "7", id_x: true })).toBeNull();
    expect(itemReferenceOf({ id_alat: "7", id_x: "0" })).toBeNull();
    expect(itemReferenceOf({ id_alat: "7", id_x: "1a" })).toBeNull();
  });

  it("the type is id_alat, a positive integer", () => {
    expect(typeReferenceOf({ id_alat: 7 })).toBe("7");
    expect(typeReferenceOf({ id_alat: " 8" })).toBe("8");
    expect(typeReferenceOf({ id_alat: null })).toBeNull();
    expect(typeReferenceOf({ id_alat: "-1" })).toBeNull();
  });
});

describe("P24-02d who owns a template", () => {
  it("none, or an active one last authored by the transform (or never), with no open draft", () => {
    expect(transformOwns(undefined)).toBe(true);
    expect(transformOwns(state())).toBe(true);
    expect(transformOwns(state({ lastAuthor: "system:upstream-transform" }))).toBe(true);
    expect(transformOwns(state({ lastAuthor: "user" }))).toBe(false);
    expect(transformOwns(state({ lastAuthor: "system:catalogue-seed" }))).toBe(false);
    expect(transformOwns(state({ draftOpen: true }))).toBe(false);
    expect(transformOwns(state({ status: "retired" }))).toBe(false);
  });

  it("the fingerprint ignores item ids and version numbers, and sees the base version", () => {
    const item = { ...(CONTENT.get(DEF_F1) as ItemContent), id: "x", itemDefinitionId: DEF_F1, origin: "type" as const, sortOrder: 0 };
    expect(fingerprintOf(TYPE_A, BASE_VERSION, [item])).toBe(fingerprintOf(TYPE_A, BASE_VERSION, [{ ...item, id: "y" }]));
    expect(fingerprintOf(TYPE_A, BASE_VERSION, [item])).not.toBe(fingerprintOf(TYPE_A, "other", [item]));
    expect(fingerprintOf(TYPE_A, BASE_VERSION, [item])).not.toBe(fingerprintOf(TYPE_A, BASE_VERSION, [{ ...item, label: "relabelled" }]));
  });
});

describe("P24-02d the plan", () => {
  it("a new type: a template, version 1 with its items in upstream order per section and the base materialised, hashed canonically; duplicates merged", () => {
    const rows = [fungsi("12", "7", "2"), fungsi("10", "7", "1"), fungsi("11", "7", "1"), kelengkapan("10", "7", "1")];
    const plan = planTemplates(input(rows));
    expect(plan.quarantine).toEqual([]);
    expect(plan.createTemplates).toEqual([{ id: "a2402000-0000-4000-8000-000000000001", deviceTypeId: TYPE_A }]);
    expect(plan.versions).toHaveLength(1);
    const [version] = plan.versions;
    expect(version).toMatchObject({ templateId: "a2402000-0000-4000-8000-000000000001", deviceTypeId: TYPE_A, versionNumber: 1, retireId: null });
    // Legacy 10 (fungsi) and 10 (kelengkapan) tie on the id: the table name orders them.
    expect(version?.typeItems.map((i) => [i.definitionId, i.sortOrder])).toEqual([[DEF_F1, 0], [DEF_K1, 0], [DEF_F2, 1]]);
    expect(version?.baseItems).toEqual([{ id: expect.any(String) as string, sourceId: BASE_ITEM }]);
    const items: CanonicalTemplateItemInput[] = [
      ...(version?.typeItems ?? []).map((i) => ({ ...(CONTENT.get(i.definitionId) as ItemContent), id: i.id, itemDefinitionId: i.definitionId, origin: "type" as const, sortOrder: i.sortOrder })),
      { ...(BASE_ITEMS[0] as CanonicalTemplateItemInput), id: version?.baseItems[0]?.id as string },
    ];
    const expected = createHash("sha256")
      .update(canonicalTemplateVersion({ templateId: version?.templateId as string, deviceTypeId: TYPE_A, versionNumber: 1, baseVersionId: BASE_VERSION, items }), "utf8")
      .digest("hex");
    expect(version?.contentHash).toBe(expected);
    const merged = plan.mappings.find((m) => m.legacyId === "11");
    expect(merged).toMatchObject({ targetTable: "inspection_template_items", sourceValues: { mergedIntoLegacyId: "10" }, tenantId: null, clientFacilityId: null });
    expect(merged?.targetId).toBe(plan.mappings.find((m) => m.legacyId === "10" && m.sourceTable === "mapping_fugsi_alat")?.targetId);
    expect(plan.mappings).toHaveLength(4);
  });

  it("unresolved rows are quarantined: no type reference, an unimported type or item, a definition without content", () => {
    const rows = [
      fungsi("1", "x", "1"),
      fungsi("2", "99", "1"),
      fungsi("3", "7", "99"),
      staged("mapping_fugsi_alat", "4", { id_alat: "7" }),
      kelengkapan("5", "7", "1"),
    ];
    const plan = planTemplates(input(rows, { content: new Map([[DEF_F1, CONTENT.get(DEF_F1) as ItemContent]]) }));
    expect(plan.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([
      ["1", "reference_unresolved"],
      ["2", "reference_unresolved"],
      ["3", "reference_unresolved"],
      ["4", "reference_unresolved"],
      ["5", "reference_unresolved"],
    ]);
    expect(plan.versions).toEqual([]);
  });

  it("an item the publish would refuse (a measured item without its unit) is quarantined; the type is published without it", () => {
    const content = new Map(CONTENT).set(DEF_F2, { ...(CONTENT.get(DEF_F2) as ItemContent), inputKind: "measured", allowedOutcomes: [] });
    const plan = planTemplates(input([fungsi("1", "7", "1"), fungsi("2", "7", "2")], { content }));
    expect(plan.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([["2", "item_content_incomplete"]]);
    expect(plan.versions[0]?.typeItems.map((i) => i.definitionId)).toEqual([DEF_F1]);
  });

  it("the operator's checklist is left alone: every row of the type quarantined", () => {
    const plan = planTemplates(input([fungsi("1", "7", "1"), fungsi("2", "8", "2")], { templates: new Map([[TYPE_A, state({ lastAuthor: "user" })]]) }));
    expect(plan.quarantine).toEqual([{ sourceTable: "mapping_fugsi_alat", sourceRowNumber: "101", legacyId: "1", reason: "template_operator_managed" }]);
    expect(plan.versions.map((v) => v.deviceTypeId)).toEqual([TYPE_B]);
  });

  it("an existing template with nothing published gets the next number and no new template", () => {
    const plan = planTemplates(input([fungsi("1", "7", "1")], { templates: new Map([[TYPE_A, state({ maxNumber: 2 })]]) }));
    expect(plan.createTemplates).toEqual([]);
    expect(plan.versions[0]).toMatchObject({ templateId: state().templateId, versionNumber: 3, retireId: null });
  });

  const publishedOf = (versionId: string, definitionIds: string[], base = BASE_ITEMS): CanonicalTemplateItemInput[] => [
    ...definitionIds.map((d, n) => ({ ...(CONTENT.get(d) as ItemContent), id: `item-${d}`, itemDefinitionId: d, origin: "type" as const, sortOrder: n })),
    ...base.map((b) => ({ ...b, id: `${versionId}-base` })),
  ];

  it("unchanged content keeps the published version: unchanged rows skipped, a changed row re-mapped to its item", () => {
    const published = state({ publishedId: "v1", publishedBaseId: BASE_VERSION, maxNumber: 1, lastAuthor: "system:upstream-transform" });
    const rows = [fungsi("1", "7", "1", { decision: "unchanged", targetId: `item-${DEF_F1}` }), fungsi("2", "7", "2", { decision: "changed", targetId: `item-${DEF_F2}` })];
    const plan = planTemplates(input(rows, { templates: new Map([[TYPE_A, published]]), publishedItems: new Map([["v1", publishedOf("v1", [DEF_F1, DEF_F2])]]) }));
    expect(plan.versions).toEqual([]);
    expect(plan.mappings.map((m) => [m.legacyId, m.targetId])).toEqual([["2", `item-${DEF_F2}`]]);
  });

  it("changed content (a relabel, a new base, or a missing published list) publishes the next version and retires the published one", () => {
    const published = state({ publishedId: "v1", publishedBaseId: BASE_VERSION, maxNumber: 1, lastAuthor: "system:upstream-transform" });
    const rows = [fungsi("1", "7", "1", { decision: "unchanged", targetId: `item-${DEF_F1}` })];
    const relabelled = new Map(CONTENT).set(DEF_F1, content("function", "Fungsi satu (baru)"));
    const relabel = planTemplates(input(rows, { content: relabelled, templates: new Map([[TYPE_A, published]]), publishedItems: new Map([["v1", publishedOf("v1", [DEF_F1])]]) }));
    expect(relabel.versions[0]).toMatchObject({ versionNumber: 2, retireId: "v1" });
    expect(relabel.mappings[0]?.targetId).toBe(relabel.versions[0]?.typeItems[0]?.id);
    const rebased = planTemplates(input(rows, { templates: new Map([[TYPE_A, { ...published, publishedBaseId: "old-base" }]]), publishedItems: new Map([["v1", publishedOf("v1", [DEF_F1])]]) }));
    expect(rebased.versions).toHaveLength(1);
    const missing = planTemplates(input(rows, { templates: new Map([[TYPE_A, published]]) }));
    expect(missing.versions).toHaveLength(1);
  });
});

describe("P24-02d the step", () => {
  const BASE_ROW = { ...(BASE_ITEMS[0] as CanonicalTemplateItemInput), versionId: BASE_VERSION };

  const world = (extra: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } =>
    double([
      ...extra,
      [/to_regclass/, (c) => [{ present: c.bind[0] === "upstream_import.stg_mapping_fugsi_alat" }]],
      [/AS row/, () => [fungsi("1", "7", "1"), fungsi("2", "7", "1")]],
      [/JOIN device_types t/, () => [{ legacyId: "7", targetId: TYPE_A }]],
      [/JOIN inspection_item_definitions t/, () => [{ legacyId: "1", targetId: DEF_F1 }]],
      [/default_required AS required FROM inspection_item_definitions/, () => [{ id: DEF_F1, ...CONTENT.get(DEF_F1) }]],
      [/AS "lastAuthor"/, () => []],
      [/WHERE t.device_type_id IS NULL/, () => [{ versionId: BASE_VERSION }]],
      [/FROM inspection_template_items i/, () => [BASE_ROW]],
    ]);

  it("nothing staged: nothing read beyond the table checks", async () => {
    const runner = double();
    await runTemplates(context(runner));
    expect(runner.calls.every((c) => c.text.includes("to_regclass"))).toBe(true);
    expect(runner.calls).toHaveLength(5);
  });

  it("a new type: template, draft, items, base copies, publish, audit rows, quarantine and maps — every value bound", async () => {
    const runner = world();
    await runTemplates(context(runner));
    const texts = runner.calls.map((c) => c.text);
    const read = runner.calls.find((c) => c.text.includes("AS row"));
    expect(read?.text).toContain('FROM upstream_import."stg_mapping_fugsi_alat" s');
    expect(read?.bind).toEqual([RUN, "mapping_fugsi_alat"]);
    expect(runner.calls.find((c) => c.text.includes("JOIN device_types t"))?.bind).toEqual(["mst_alat", ["7"]]);
    expect(runner.calls.find((c) => c.text.includes("JOIN inspection_item_definitions t"))?.bind).toEqual(["mst_pemeriksaan_fungsi_alat", ["1"]]);
    expect(runner.calls.find((c) => c.text.includes("t.status = 'active'"))).toBeDefined();
    const template = runner.calls.find((c) => c.text.startsWith("INSERT INTO inspection_templates"));
    expect(template?.bind[1]).toEqual([TYPE_A]);
    const draft = runner.calls.find((c) => c.text.startsWith("INSERT INTO inspection_template_versions"));
    expect(draft?.text).toContain("'draft', 0");
    const [typeItems, baseItems] = runner.calls.filter((c) => c.text.startsWith("INSERT INTO inspection_template_items"));
    expect(typeItems?.text).toContain("'type'");
    expect(typeItems?.text).toContain("JOIN inspection_item_definitions d ON d.id = v.definition");
    expect(typeItems?.bind[2]).toEqual([DEF_F1]);
    expect(baseItems?.text).toContain("JOIN inspection_template_items d ON d.id = v.source");
    expect(baseItems?.bind[2]).toEqual([BASE_ITEM]);
    expect(texts.some((t) => t.includes("SET status = 'retired'"))).toBe(false);
    const publish = runner.calls.find((c) => c.text.includes("SET status = 'published'"));
    expect(publish?.bind.slice(3)).toEqual([BASE_VERSION, IMPORT_CHANGE_NOTE, "system:upstream-transform"]);
    expect(publish?.bind[1]).toEqual([1]);
    const audit = runner.calls.find((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audit?.bind[0]).toEqual(["CREATE", "APPROVE"]);
    expect(audit?.bind[1]).toEqual(["InspectionTemplate", "InspectionTemplateVersion"]);
    const changes = (audit?.bind[3] as string[]).map((c) => JSON.parse(c) as Record<string, unknown>);
    expect(changes[1]).toMatchObject({ operation: "PUBLISH_TEMPLATE_VERSION", importRunId: RUN, versionNumber: 1, baseVersionId: BASE_VERSION, retiredVersionId: null, itemCount: 2 });
    expect(JSON.stringify(changes)).not.toMatch(/legacy/i);
    const map = runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.id_map"));
    expect(map?.bind.filter((v) => v === "inspection_template_items")).toHaveLength(2);
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("an existing published version is retired; with no base items no base copy is written", async () => {
    const runner = world([
      [/AS "lastAuthor"/, () => [state({ publishedId: "v1", publishedBaseId: BASE_VERSION, maxNumber: 1, lastAuthor: "system:upstream-transform" })]],
      [/FROM inspection_template_items i/, () => []],
    ]);
    await runTemplates(context(runner));
    expect(runner.calls.some((c) => c.text.startsWith("INSERT INTO inspection_templates"))).toBe(false);
    expect(runner.calls.filter((c) => c.text.startsWith("INSERT INTO inspection_template_items"))).toHaveLength(1);
    expect(runner.calls.find((c) => c.text.includes("SET status = 'retired'"))?.bind).toEqual([["v1"]]);
  });

  it("an existing template with nothing published: no retirement, the next number", async () => {
    const runner = world([[/AS "lastAuthor"/, () => [state({ maxNumber: 1 })]]]);
    await runTemplates(context(runner));
    expect(runner.calls.find((c) => c.text.includes("FROM inspection_template_items i"))?.bind).toEqual([[BASE_VERSION]]);
    expect(runner.calls.find((c) => c.text.includes("SET status = 'published'"))?.bind[1]).toEqual([2]);
    expect(runner.calls.some((c) => c.text.includes("SET status = 'retired'"))).toBe(false);
  });

  it("nothing to publish writes no template row, only the quarantine; no type key reads no id map", async () => {
    const runner = world([[/AS row/, () => [fungsi("1", "x", "1")]]]);
    await runTemplates(context(runner));
    expect(runner.calls.some((c) => c.text.includes("JOIN device_types t"))).toBe(false);
    expect(runner.calls.some((c) => /INSERT INTO inspection_template|INSERT INTO audit_logs/.test(c.text))).toBe(false);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.quarantine"))?.bind).toContain("reference_unresolved");
  });

  it("no published base version fails the transform", async () => {
    const runner = world([[/WHERE t.device_type_id IS NULL/, () => []]]);
    await expect(runTemplates(context(runner))).rejects.toEqual(expect.objectContaining({ code: "TRANSFORM_FAILED" }));
    await expect(runTemplates(context(world([[/WHERE t.device_type_id IS NULL/, () => []]])))).rejects.toBeInstanceOf(TransformFailure);
  });
});
