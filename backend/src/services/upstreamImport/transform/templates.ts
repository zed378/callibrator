/**
 * Step 5 of the transform (P24-02d; ADR-129 Am. 6; P19-01 spec § 4.3 – § 4.5, § 7.2, § 7.6;
 * 04 § 4.5; 05 § 3.1 step 5): the five `mapping_*` tables → ONE PUBLISHED VERSION PER DEVICE TYPE
 * of the GLOBAL inspection templates (`inspection_templates`, `inspection_template_versions`,
 * `inspection_template_items`).
 *
 * A mapping row names a device type (`id_alat` → step 3's `mst_alat` mapping) and an item of its
 * checklist table (the row's one `id_*` column besides `id_alat` → step 4's mapping of that
 * table). A row whose type or item was not imported, or whose item is no longer active, is
 * quarantined `reference_unresolved`; a row whose item the catalogue service's publish would refuse
 * (`inspectionContentProblems` — a measured item without its unit, …) `item_content_incomplete`: the
 * version is published without it, and the next run adds it once the operator completes the
 * definition (a quarantined row is decided again on every run). Duplicate (type, item) pairs — five in `mapping_fugsi_alat`
 * (03 § 4.4) — are ONE item: the lowest legacy id survives, the others map to it
 * (`mergedIntoLegacyId`).
 *
 * The version is what the catalogue service's publish makes (§ 7.2), written directly on the
 * transform connection (ADR-129 Am. 5): the type's items copied from their definitions in
 * upstream id order per section; the base template's PUBLISHED items materialised into it
 * (`origin = base`, `base_version_id`); `content_hash` the SHA-256 of @callibrator/contracts
 * `canonicalTemplateVersion` — the same function, so `/verify` recomputes the same hash; the
 * previous published version retired; `published_by_system = system:upstream-transform`.
 *
 * WHEN A TYPE GETS A NEW VERSION. The type's would-be content is compared with its published
 * version's by a FINGERPRINT — the canonical form with every item id replaced by its definition
 * id, version number 0 — so a re-run of the same dump writes nothing, and a re-run after upstream
 * added, removed or relabelled an item (or after the operator republished the base) publishes the
 * next version. A type with no mapping row in the run is not touched.
 *
 * THE OPERATOR'S CHECKLIST IS NEVER REPLACED. A type whose template is retired, has an open
 * operator draft, or whose latest AUTHORED version (a base rebase is not authoring, § 7.3) was
 * published by anyone but the transform has every row quarantined `template_operator_managed`.
 *
 * AUDIT. This step writes its own rows, the service's shape (§ 7.2): CREATE per template and
 * APPROVE per published version (`PUBLISH_TEMPLATE_VERSION`, with the retired version), under the
 * PLATFORM tenant, actor `system:upstream-transform`. The items are the version's frozen content and
 * are covered by its APPROVE row, as in the service; step 13 skips these tables (auditRows.ts
 * `STEP_AUDITED`). No legacy id and no value enters an audit row (07 § 3).
 */
import { createHash, randomUUID } from "crypto";
import {
  canonicalTemplateVersion,
  inspectionContentProblems,
  type CanonicalTemplateItemInput,
  type InspectionItemContent,
  type InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import { sql } from "../../../utils/sql.util";
import { PLATFORM_TENANT_ID } from "../../../constants/platformTenant";
import { SYSTEM_ACTORS } from "../../../constants/systemActors";
import { RESOURCE_TYPES } from "./auditRows";
import { ID_MAP, classifiedSql, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import { DEFINITION_TABLES } from "./catalogue";
import { TransformFailure } from "./failure";
import type { StepContext, TransformSource } from "./steps";

type Decision = "new" | "unchanged" | "changed";

/** The checklist table each mapping table points into (03 § 4.4), in 05 § 3.1's order. */
export const TEMPLATE_TABLES: Readonly<Record<string, string>> = Object.freeze({
  mapping_fugsi_alat: "mst_pemeriksaan_fungsi_alat",
  mapping_alat_kerja_digunakan: "mst_alat_kerja_digunakan",
  mapping_keamanan_listrik: "mst_pemeriksaan_keamanan_listrik",
  mapping_kelengkapan_alat: "mst_kelengkapan_alat",
  mapping_kinerja_alat: "mst_pemeriksaan_kinerja_alat",
});

/** The mapping tables (every one keyed by its id). */
export const TEMPLATE_SOURCES: readonly TransformSource[] = Object.freeze(
  Object.keys(TEMPLATE_TABLES).map((table) => Object.freeze({ table, legacyId: 's."id"::text' })),
);

/** The change note of every version the transform publishes (0112: 3 … 2000 characters). */
export const IMPORT_CHANGE_NOTE = "Imported from the upstream IPM system (ADR-129).";

const TRANSFORM_ACTOR = SYSTEM_ACTORS.UPSTREAM_TRANSFORM;

/** A staged mapping row: its classification, its columns, and where its earlier target is. */
export interface StagedTemplateRow {
  table: string;
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  row: Readonly<Record<string, unknown>>;
}

/** A definition's content as a version copies it (decimals as text), and whether it is required by default. */
export type ItemContent = InspectionItemContent & { readonly required: boolean };

/** A device type's template, as the step finds it. */
export interface TemplateState {
  templateId: string;
  deviceTypeId: string;
  status: string;
  publishedId: string | null;
  publishedBaseId: string | null;
  maxNumber: number | null;
  draftOpen: boolean;
  /** The latest authored (not rebased) published or retired version's publisher: a system actor, `user`, or null when none. */
  lastAuthor: string | null;
}

/** What the plan reads. */
export interface TemplateInput {
  rows: readonly StagedTemplateRow[];
  /** `mst_alat` legacy id → device type id (imported). */
  types: ReadonlyMap<string, string>;
  /** `<mst table>:<legacy id>` → definition id (imported and active). */
  definitions: ReadonlyMap<string, string>;
  /** definition id → its content. */
  content: ReadonlyMap<string, ItemContent>;
  /** device type id → its template. */
  templates: ReadonlyMap<string, TemplateState>;
  /** published version id → its items. */
  publishedItems: ReadonlyMap<string, readonly CanonicalTemplateItemInput[]>;
  /** The base template's published version and its items. */
  base: { versionId: string; items: readonly CanonicalTemplateItemInput[] };
  newId: () => string;
}

/** One version the plan publishes. */
export interface PlannedVersion {
  id: string;
  templateId: string;
  deviceTypeId: string;
  versionNumber: number;
  retireId: string | null;
  contentHash: string;
  /** The type's items: new ids, copied from their definitions. */
  typeItems: { id: string; definitionId: string; sortOrder: number }[];
  /** The base's items materialised: new ids, copied from the base version's items. */
  baseItems: { id: string; sourceId: string }[];
}

/** What the plan writes. */
export interface TemplatePlan {
  createTemplates: { id: string; deviceTypeId: string }[];
  versions: PlannedVersion[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The legacy id of the checklist item a mapping row names: its one `id_*` column besides `id_alat`
 * (the five tables' item columns are named after their catalogue, 03 § 4.4). Null when there is not
 * exactly one, or its value is not a positive integer.
 */
export const itemReferenceOf = (row: Readonly<Record<string, unknown>>): string | null => {
  const keys = Object.keys(row).filter((key) => key.startsWith("id_") && key !== "id_alat");
  if (keys.length !== 1) {
    return null;
  }
  const value = row[keys[0] as string];
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^[1-9]\d{0,17}$/.test(text) ? text : null;
};

/** The type a mapping row names (`id_alat`), as a legacy id; null when it is not a positive integer. */
export const typeReferenceOf = (row: Readonly<Record<string, unknown>>): string | null => {
  const value = row["id_alat"];
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^[1-9]\d{0,17}$/.test(text) ? text : null;
};

/** Whether the transform may write `state`'s template (see the header: the operator's checklist is never replaced). */
export const transformOwns = (state: TemplateState | undefined): boolean =>
  state === undefined || (state.status === "active" && !state.draftOpen && (state.lastAuthor === null || state.lastAuthor === TRANSFORM_ACTOR));

/** The fingerprint of a version's content: its canonical form, item ids replaced by definition ids, version 0. */
export const fingerprintOf = (deviceTypeId: string, baseVersionId: string | null, items: readonly CanonicalTemplateItemInput[]): string =>
  canonicalTemplateVersion({
    templateId: "fingerprint",
    deviceTypeId,
    versionNumber: 0,
    baseVersionId,
    items: items.map((item) => ({ ...item, id: item.itemDefinitionId })),
  });

const byLegacyId = (a: StagedTemplateRow, b: StagedTemplateRow): number =>
  Number(a.legacyId) - Number(b.legacyId) || a.table.localeCompare(b.table);

const sectionOfTable = (table: string): InspectionSection =>
  DEFINITION_TABLES[TEMPLATE_TABLES[table] as string] as InspectionSection;

/** One type's resolved rows: each row with its definition. */
interface TypeGroup {
  deviceTypeId: string;
  rows: { row: StagedTemplateRow; definitionId: string }[];
}

/**
 * Decide every staged mapping row. Pure.
 */
export const planTemplates = (input: TemplateInput): TemplatePlan => {
  const plan: TemplatePlan = { createTemplates: [], versions: [], mappings: [], quarantine: [] };
  const quarantine = (row: StagedTemplateRow, reason: QuarantineEntry["reason"]): void => {
    plan.quarantine.push({ sourceTable: row.table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
  };
  const groups = new Map<string, TypeGroup>();
  for (const row of [...input.rows].sort(byLegacyId)) {
    const typeLegacy = typeReferenceOf(row.row);
    const itemLegacy = itemReferenceOf(row.row);
    const deviceTypeId = typeLegacy === null ? undefined : input.types.get(typeLegacy);
    const definitionId = itemLegacy === null ? undefined : input.definitions.get(`${TEMPLATE_TABLES[row.table] as string}:${itemLegacy}`);
    const definition = definitionId === undefined ? undefined : input.content.get(definitionId);
    if (deviceTypeId === undefined || definitionId === undefined || definition === undefined) {
      quarantine(row, "reference_unresolved");
      continue;
    }
    // The publish's own check (inspectionTemplate.service publishVersion, § 7.2): an item the operator
    // could not publish is not published by the import either — e.g. a measured item with no unit.
    if (inspectionContentProblems(definition).length > 0) {
      quarantine(row, "item_content_incomplete");
      continue;
    }
    const group = groups.get(deviceTypeId) ?? { deviceTypeId, rows: [] };
    group.rows.push({ row, definitionId });
    groups.set(deviceTypeId, group);
  }

  for (const group of groups.values()) {
    const state = input.templates.get(group.deviceTypeId);
    if (!transformOwns(state)) {
      group.rows.forEach(({ row }) => {
        quarantine(row, "template_operator_managed");
      });
      continue;
    }
    // The type's items: one per definition (the lowest legacy id survives), in upstream id order per section.
    const survivors = new Map<string, StagedTemplateRow>();
    const positions = new Map<string, number>();
    const perSection = new Map<InspectionSection, number>();
    for (const { row, definitionId } of group.rows) {
      if (!survivors.has(definitionId)) {
        survivors.set(definitionId, row);
        const section = sectionOfTable(row.table);
        const next = perSection.get(section) ?? 0;
        positions.set(definitionId, next);
        perSection.set(section, next + 1);
      }
    }
    const desired = (idOf: (definitionId: string) => string): CanonicalTemplateItemInput[] =>
      [...positions].map(([definitionId, sortOrder]) => ({
        ...(input.content.get(definitionId) as ItemContent),
        id: idOf(definitionId),
        itemDefinitionId: definitionId,
        origin: "type",
        sortOrder,
      }));
    const baseCopies = (idOf: (source: CanonicalTemplateItemInput) => string): CanonicalTemplateItemInput[] =>
      input.base.items.map((item) => ({ ...item, id: idOf(item), origin: "base" }));

    const current = state?.publishedId ? { items: input.publishedItems.get(state.publishedId) ?? [], baseId: state.publishedBaseId } : null;
    const same =
      current !== null &&
      fingerprintOf(group.deviceTypeId, current.baseId, current.items) ===
        fingerprintOf(group.deviceTypeId, input.base.versionId, [...desired((d) => d), ...baseCopies((i) => i.itemDefinitionId)]);

    let itemOf: ReadonlyMap<string, string>;
    if (same) {
      // Unchanged content: the published version's own items are the rows' targets.
      itemOf = new Map(current.items.filter((i) => i.origin === "type").map((i) => [i.itemDefinitionId, i.id]));
    } else {
      let templateId = state?.templateId;
      if (templateId === undefined) {
        templateId = input.newId();
        plan.createTemplates.push({ id: templateId, deviceTypeId: group.deviceTypeId });
      }
      const typeIds = new Map([...positions.keys()].map((definitionId) => [definitionId, input.newId()]));
      const baseIds = new Map(input.base.items.map((item) => [item.id, input.newId()]));
      const versionNumber = (state?.maxNumber ?? 0) + 1;
      const items = [...desired((d) => typeIds.get(d) as string), ...baseCopies((i) => baseIds.get(i.id) as string)];
      plan.versions.push({
        id: input.newId(),
        templateId,
        deviceTypeId: group.deviceTypeId,
        versionNumber,
        retireId: state?.publishedId ?? null,
        contentHash: sha256(
          canonicalTemplateVersion({ templateId, deviceTypeId: group.deviceTypeId, versionNumber, baseVersionId: input.base.versionId, items }),
        ),
        typeItems: [...positions].map(([definitionId, sortOrder]) => ({ id: typeIds.get(definitionId) as string, definitionId, sortOrder })),
        baseItems: [...baseIds].map(([sourceId, id]) => ({ id, sourceId })),
      });
      itemOf = typeIds;
    }

    for (const { row, definitionId } of group.rows) {
      const targetId = itemOf.get(definitionId) as string;
      if (row.decision === "unchanged" && row.targetId === targetId) {
        continue;
      }
      const survivor = survivors.get(definitionId) as StagedTemplateRow;
      plan.mappings.push({
        sourceTable: row.table,
        legacyId: row.legacyId,
        targetTable: "inspection_template_items",
        targetId,
        tenantId: null,
        clientFacilityId: null,
        rowHash: row.rowHash,
        sourceValues: survivor === row ? null : { mergedIntoLegacyId: survivor.legacyId },
      });
    }
  }
  return plan;
};

/** The content columns of a definition or an item, aliased as the canonical form names them (decimals as text). */
const CONTENT_COLUMNS = (alias: string): string =>
  `${alias}.section::text AS section, ${alias}.label, ${alias}.input_kind::text AS "inputKind", ${alias}.unit, ${alias}.symbol,
   ${alias}.setting_text AS "settingText", ${alias}.setting_value::text AS "settingValue", ${alias}.limit_op::text AS "limitOp",
   ${alias}.limit_value::text AS "limitValue", ${alias}.limit_low::text AS "limitLow", ${alias}.limit_high::text AS "limitHigh",
   ${alias}.limit_nominal::text AS "limitNominal", ${alias}.limit_tolerance::text AS "limitTolerance", ${alias}.limit_text AS "limitText",
   ${alias}.valid_min::text AS "validMin", ${alias}.valid_max::text AS "validMax", ${alias}.warn_min::text AS "warnMin",
   ${alias}.warn_max::text AS "warnMax", ${alias}.allowed_outcomes::text[] AS "allowedOutcomes"`;

/** The item columns an INSERT copies from a source row aliased `d` (a definition or an item; casts to the items' ENUMs). */
const ITEM_COPY = `d.section::text::"enum_inspection_template_items_section", d.label,
       d.input_kind::text::"enum_inspection_template_items_input_kind", d.unit, d.symbol, d.setting_text, d.setting_value,
       d.limit_op::text::"enum_inspection_template_items_limit_op", d.limit_value, d.limit_low, d.limit_high, d.limit_nominal,
       d.limit_tolerance, d.limit_text, d.valid_min, d.valid_max, d.warn_min, d.warn_max,
       d.allowed_outcomes::text[]::"enum_inspection_template_items_allowed_outcomes"[]`;

const ITEM_COLUMNS = `id, version_id, item_definition_id, origin, section, label, input_kind, unit, symbol, setting_text, setting_value,
       limit_op, limit_value, limit_low, limit_high, limit_nominal, limit_tolerance, limit_text, valid_min, valid_max, warn_min,
       warn_max, allowed_outcomes, required, sort_order, created_at, updated_at`;

/** The run's staged rows of one mapping table, classified, each with its columns. */
const readStaged = async (context: StepContext, source: TransformSource): Promise<StagedTemplateRow[]> =>
  sql<StagedTemplateRow>(
    context.runner,
    `SELECT $2::text AS "table", c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision,
            to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row
       FROM (${classifiedSql(source)}) c
       JOIN ${stagedTable(source.table)} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint`,
    [context.runId, source.table],
    { transaction: context.transaction },
  );

/** The current mappings of `table`'s keys whose target still exists (and, for a definition, is active). */
const resolved = async (context: StepContext, table: string, keys: readonly string[], target: "device_types" | "inspection_item_definitions"): Promise<Map<string, string>> => {
  if (keys.length === 0) {
    return new Map();
  }
  const rows =
    target === "device_types"
      ? await sql<{ legacyId: string; targetId: string }>(
        context.runner,
        `SELECT m.legacy_id AS "legacyId", m.target_id AS "targetId" FROM ${ID_MAP} m JOIN device_types t ON t.id = m.target_id
          WHERE m.source_table = $1 AND m.legacy_id = ANY($2::text[])`,
        [table, [...keys]],
        { transaction: context.transaction },
      )
      : await sql<{ legacyId: string; targetId: string }>(
        context.runner,
        `SELECT m.legacy_id AS "legacyId", m.target_id AS "targetId" FROM ${ID_MAP} m
           JOIN inspection_item_definitions t ON t.id = m.target_id AND t.status = 'active'
          WHERE m.source_table = $1 AND m.legacy_id = ANY($2::text[])`,
        [table, [...keys]],
        { transaction: context.transaction },
      );
  return new Map(rows.map((r) => [r.legacyId, r.targetId]));
};

type ItemRow = CanonicalTemplateItemInput & { versionId: string };

/** The items of `versionIds` (the base's version is always one of them). */
const itemsOf = async (context: StepContext, versionIds: readonly string[]): Promise<ItemRow[]> =>
  sql<ItemRow>(
    context.runner,
    `SELECT i.id, i.version_id AS "versionId", i.item_definition_id AS "itemDefinitionId", i.origin::text AS origin,
            ${CONTENT_COLUMNS("i")}, i.required, i.sort_order AS "sortOrder"
       FROM inspection_template_items i WHERE i.version_id = ANY($1::uuid[])`,
    [[...versionIds]],
    { transaction: context.transaction },
  );

/** Step 5's `run`: the templates. */
export const runTemplates = async (context: StepContext): Promise<void> => {
  const { runner, transaction } = context;
  const rows: StagedTemplateRow[] = [];
  for (const source of TEMPLATE_SOURCES) {
    if (await stagedTableExists(context, source.table)) {
      rows.push(...(await readStaged(context, source)));
    }
  }
  if (rows.length === 0) {
    return;
  }

  const types = await resolved(context, "mst_alat", [...new Set(rows.map((r) => typeReferenceOf(r.row)).filter((k) => k !== null))], "device_types");
  const definitions = new Map<string, string>();
  for (const [table, catalogue] of Object.entries(TEMPLATE_TABLES)) {
    const keys = [...new Set(rows.filter((r) => r.table === table).map((r) => itemReferenceOf(r.row)).filter((k) => k !== null))];
    for (const [legacy, id] of await resolved(context, catalogue, keys, "inspection_item_definitions")) {
      definitions.set(`${catalogue}:${legacy}`, id);
    }
  }
  const content = new Map(
    (
      await sql<ItemContent & { id: string }>(
        runner,
        `SELECT d.id, ${CONTENT_COLUMNS("d")}, d.default_required AS required FROM inspection_item_definitions d WHERE d.id = ANY($1::uuid[])`,
        [[...new Set(definitions.values())]],
        { transaction },
      )
    ).map(({ id, ...rest }) => [id, rest]),
  );
  const templates = await sql<TemplateState>(
    runner,
    `SELECT t.id AS "templateId", t.device_type_id AS "deviceTypeId", t.status::text AS status,
            p.id AS "publishedId", p.base_version_id AS "publishedBaseId",
            (SELECT max(x.version_number) FROM inspection_template_versions x WHERE x.template_id = t.id) AS "maxNumber",
            EXISTS (SELECT 1 FROM inspection_template_versions d
                     WHERE d.template_id = t.id AND d.status = 'draft' AND d.rebased_from_version_id IS NULL) AS "draftOpen",
            (SELECT coalesce(a.published_by_system, 'user') FROM inspection_template_versions a
              WHERE a.template_id = t.id AND a.rebased_from_version_id IS NULL AND a.status IN ('published', 'retired')
              ORDER BY a.version_number DESC LIMIT 1) AS "lastAuthor"
       FROM inspection_templates t
       LEFT JOIN inspection_template_versions p ON p.template_id = t.id AND p.status = 'published'
      WHERE t.device_type_id = ANY($1::uuid[])`,
    [[...new Set(types.values())]],
    { transaction },
  );
  const [base] = await sql<{ versionId: string }>(
    runner,
    `SELECT v.id AS "versionId" FROM inspection_templates t
       JOIN inspection_template_versions v ON v.template_id = t.id AND v.status = 'published'
      WHERE t.device_type_id IS NULL`,
    [],
    { transaction },
  );
  if (base === undefined) {
    throw new TransformFailure("TRANSFORM_FAILED", "The base checklist has no published version; publish the base first.");
  }
  const published = await itemsOf(context, [base.versionId, ...templates.flatMap((t) => (t.publishedId === null ? [] : [t.publishedId]))]);
  const byVersion = new Map<string, CanonicalTemplateItemInput[]>();
  for (const { versionId, ...item } of published) {
    byVersion.set(versionId, [...(byVersion.get(versionId) ?? []), item]);
  }

  const plan = planTemplates({
    rows,
    types,
    definitions,
    content,
    templates: new Map(templates.map((t) => [t.deviceTypeId, t])),
    publishedItems: byVersion,
    base: { versionId: base.versionId, items: byVersion.get(base.versionId) ?? [] },
    newId: randomUUID,
  });
  await writePlan(context, plan, base.versionId);
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};

/** The plan's templates, versions, items and audit rows. */
const writePlan = async (context: StepContext, plan: TemplatePlan, baseVersionId: string): Promise<void> => {
  const { runner, transaction } = context;
  if (plan.versions.length === 0) {
    return;
  }
  if (plan.createTemplates.length > 0) {
    await sql(
      runner,
      `INSERT INTO inspection_templates (id, device_type_id, status, created_at, updated_at)
       SELECT v.id, v.type, 'active', now(), now() FROM unnest($1::uuid[], $2::uuid[]) AS v(id, type)`,
      [plan.createTemplates.map((t) => t.id), plan.createTemplates.map((t) => t.deviceTypeId)],
      { transaction },
    );
  }
  // Drafts first: the items trigger (0112) accepts items only into a draft.
  await sql(
    runner,
    `INSERT INTO inspection_template_versions (id, template_id, status, revision, created_at, updated_at)
     SELECT v.id, v.template, 'draft', 0, now(), now() FROM unnest($1::uuid[], $2::uuid[]) AS v(id, template)`,
    [plan.versions.map((v) => v.id), plan.versions.map((v) => v.templateId)],
    { transaction },
  );
  const typeItems = plan.versions.flatMap((v) => v.typeItems.map((i) => ({ ...i, versionId: v.id })));
  await sql(
    runner,
    `INSERT INTO inspection_template_items (${ITEM_COLUMNS})
     SELECT v.id, v.version, d.id, 'type', ${ITEM_COPY}, d.default_required, v.position, now(), now()
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::int[]) AS v(id, version, definition, position)
       JOIN inspection_item_definitions d ON d.id = v.definition`,
    [typeItems.map((i) => i.id), typeItems.map((i) => i.versionId), typeItems.map((i) => i.definitionId), typeItems.map((i) => i.sortOrder)],
    { transaction },
  );
  const baseItems = plan.versions.flatMap((v) => v.baseItems.map((i) => ({ ...i, versionId: v.id })));
  if (baseItems.length > 0) {
    await sql(
      runner,
      `INSERT INTO inspection_template_items (${ITEM_COLUMNS})
       SELECT v.id, v.version, d.item_definition_id, 'base', ${ITEM_COPY}, d.required, d.sort_order, now(), now()
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS v(id, version, source)
         JOIN inspection_template_items d ON d.id = v.source`,
      [baseItems.map((i) => i.id), baseItems.map((i) => i.versionId), baseItems.map((i) => i.sourceId)],
      { transaction },
    );
  }
  // One published version per template (0112): the previous one is retired first.
  const retired = plan.versions.flatMap((v) => (v.retireId === null ? [] : [v.retireId]));
  if (retired.length > 0) {
    await sql(
      runner,
      `UPDATE inspection_template_versions SET status = 'retired', retired_at = now(), updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'published'`,
      [retired],
      { transaction },
    );
  }
  await sql(
    runner,
    `UPDATE inspection_template_versions v
        SET status = 'published', version_number = u.number, base_version_id = $4, content_hash = u.hash, change_note = $5,
            published_at = now(), published_by_system = $6, updated_at = now()
       FROM unnest($1::uuid[], $2::int[], $3::text[]) AS u(id, number, hash)
      WHERE v.id = u.id AND v.status = 'draft'`,
    [
      plan.versions.map((v) => v.id),
      plan.versions.map((v) => v.versionNumber),
      plan.versions.map((v) => v.contentHash),
      baseVersionId,
      IMPORT_CHANGE_NOTE,
      TRANSFORM_ACTOR,
    ],
    { transaction },
  );
  const entries = [
    ...plan.createTemplates.map((t) => ({
      action: "CREATE",
      resourceType: RESOURCE_TYPES["inspection_templates"] as string,
      resourceId: t.id,
      changes: { operation: "UPSTREAM_IMPORT", source: "skp_ipm", importRunId: context.runId, deviceTypeId: t.deviceTypeId },
    })),
    ...plan.versions.map((v) => ({
      action: "APPROVE",
      resourceType: RESOURCE_TYPES["inspection_template_versions"] as string,
      resourceId: v.id,
      changes: {
        operation: "PUBLISH_TEMPLATE_VERSION",
        source: "skp_ipm",
        importRunId: context.runId,
        templateId: v.templateId,
        versionNumber: v.versionNumber,
        contentHash: v.contentHash,
        baseVersionId,
        retiredVersionId: v.retireId,
        itemCount: v.typeItems.length + v.baseItems.length,
      },
    })),
  ];
  await sql(
    runner,
    `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, client_facility_id, changes, created_at)
     SELECT gen_random_uuid(), $5::uuid, NULL, 'system', $6, e.action::"enum_audit_logs_action", e.type, e.id, NULL, e.changes::jsonb, now()
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS e(action, type, id, changes, n)
      ORDER BY e.n`,
    [
      entries.map((e) => e.action),
      entries.map((e) => e.resourceType),
      entries.map((e) => e.resourceId),
      entries.map((e) => JSON.stringify(e.changes)),
      PLATFORM_TENANT_ID,
      TRANSFORM_ACTOR,
    ],
    { transaction },
  );
};
