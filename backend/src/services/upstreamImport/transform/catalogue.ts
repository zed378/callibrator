/**
 * Steps 3 and 4 of the transform (P24-02c; ADR-129 Am. 5; P19-01 spec § 4.1, § 4.2, § 5, § 6, § 12;
 * 04 § 4.3, § 4.4): the GLOBAL catalogue — `mst_alat` → `device_types` and the eleven checklist
 * tables → `inspection_item_definitions`. Global rows: `id_map.tenant_id` NULL, audited under the
 * PLATFORM tenant (auditRows.ts).
 *
 * DEVICE TYPES (§ 4.1): the name trimmed, inner whitespace collapsed, control characters dropped,
 * ≤ 255; an empty one quarantined `value_out_of_range`. Case/space duplicates (`lower(name)`) are
 * one type: the survivor is the lowest legacy id, members map to it (`mergedIntoLegacyId`). A type
 * the operator already made under the name (any status — the name is unique over all) is ADOPTED
 * (its `legacy_id` set when empty); else a new active type. A changed survivor renames its type.
 *
 * ITEM DEFINITIONS (§ 4.2, § 5): each table is one section with its input kind (§ 5.1 registry).
 * The content is built by the SAME function the catalogue service uses
 * (@callibrator/contracts `inspectionContentOf`): the label from `description`; `symbol`;
 * `setting` (performance); the limit from `nilai_acuan` where the table has it, parsed by
 * `parseLimit` (an unparsed one stays `text`, printed as written) and its unit the item's unit;
 * the upstream `notes` operator-only. `allowed_outcomes` from the upstream `status` code list
 * through § 5.1's mapping (completeness / function / other safety `1/0/-1` → pass / fail / N/A;
 * physical → good / minor / major damage; tools and maintenance `1/0` → done / not done;
 * performance `1/0` → pass / fail; electrical safety `1` → the computed pass / fail, `-1` → N/A;
 * electrical supply `-1` → N/A), kept to the section's set, and the section's whole set when the
 * list names none the kind needs.
 *
 *  - The five BASE sections (environment, electrical supply, other safety, physical, maintenance
 *    tasks) are imported **retired**: the live base checklist is the platform's neutral base
 *    version 1 (migration 0112, § 12) and no upstream text replaces it; the imported definitions
 *    exist so that imported RESULTS can point at what was asked (04 § 4.4). A retired definition
 *    cannot be added to a draft; nothing else about it differs.
 *  - The type sections are imported **active**, for the templates step (P24-02d).
 *  - `mst_rekomendasi_hasil_pekerjaan` holds the four recommendation answers — a session HEADER
 *    field (`inspection_sessions.recommendation`), not a checklist item: every row is quarantined
 *    `session_header_value` (P24-02f maps the session's code itself).
 *
 * A changed definition (another row hash) has its content and notes replaced — the template
 * versions that copied it are frozen and unaffected (§ 4.5).
 */
import { randomUUID } from "crypto";
import {
  INSPECTION_SECTION_RULES,
  inspectionContentOf,
  parseLimit,
  type InspectionItemContentInput,
  type InspectionOutcome,
  type InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import { sql } from "../../../utils/sql.util";
import { classifiedSql, quarantineRows, recordMappings, stagedTable, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import type { StepContext, TransformSource } from "./steps";

type Decision = "new" | "unchanged" | "changed";

/** A staged row as the catalogue steps read it: its classification and its columns (JSONB). */
export interface StagedCatalogueRow {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  targetId: string | null;
  decision: Decision;
  targetPresent: boolean;
  row: Readonly<Record<string, unknown>>;
}

/** `mst_alat`, keyed by its id. */
export const DEVICE_TYPE_SOURCE: TransformSource = Object.freeze({ table: "mst_alat", legacyId: 's."id"::text' });

/** The checklist tables, in 05 § 3.1's order, with their section (null: a session header value). */
export const DEFINITION_TABLES: Readonly<Record<string, InspectionSection | null>> = Object.freeze({
  mst_kelengkapan_alat: "completeness",
  mst_pemeriksaan_fungsi_alat: "function",
  mst_pemeriksaan_kinerja_alat: "performance",
  mst_alat_kerja_digunakan: "tools_used",
  mst_pemeriksaan_keamanan_listrik: "electrical_safety",
  mst_kondisi_kelistrikan: "electrical_supply",
  mst_pemeliharaan_alat: "maintenance_task",
  mst_kondisi_lingkungan: "environment",
  mst_pemeriksaan_fisik: "physical",
  mst_pemeriksaan_keamanan_lain: "other_safety",
  mst_rekomendasi_hasil_pekerjaan: null,
});

/** The definitions' sources (every table keyed by its id). */
export const DEFINITION_SOURCES: readonly TransformSource[] = Object.freeze(
  Object.keys(DEFINITION_TABLES).map((table) => Object.freeze({ table, legacyId: 's."id"::text' })),
);

/** The sections the platform's base version 1 already covers: imported retired (see the header). */
export const BASE_SECTIONS: ReadonlySet<InspectionSection> = new Set<InspectionSection>([
  "environment",
  "electrical_supply",
  "other_safety",
  "physical",
  "maintenance_task",
]);

/** Upstream `status` codes → outcomes, per section (§ 5.1, G-1). */
const CODE_OUTCOMES: Readonly<Partial<Record<InspectionSection, Readonly<Record<string, readonly InspectionOutcome[]>>>>> = Object.freeze({
  completeness: { "1": ["pass"], "0": ["fail"], "-1": ["not_applicable"] },
  function: { "1": ["pass"], "0": ["fail"], "-1": ["not_applicable"] },
  other_safety: { "1": ["pass"], "0": ["fail"], "-1": ["not_applicable"] },
  physical: { "1": ["good"], "0": ["minor_damage"], "-1": ["major_damage"] },
  tools_used: { "1": ["done"], "0": ["not_done"] },
  maintenance_task: { "1": ["done"], "0": ["not_done"] },
  performance: { "1": ["pass"], "0": ["fail"] },
  electrical_safety: { "1": ["pass", "fail"], "-1": ["not_applicable"] },
  electrical_supply: { "-1": ["not_applicable"] },
});

const LABEL_MAX = 255;

/** Text as a catalogue column holds it: control characters dropped, whitespace collapsed, trimmed, at most `max`. */
export const cleanText = (value: unknown, max: number): string => {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return text.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
};

const textOrNull = (value: unknown, max: number): string | null => {
  const text = cleanText(value, max);
  return text === "" ? null : text;
};

/** The allowed outcomes of an upstream code list in `section` (§ 5.1). */
export const outcomesOf = (section: InspectionSection, codes: unknown): InspectionOutcome[] => {
  const rule = INSPECTION_SECTION_RULES[section];
  const mapping = CODE_OUTCOMES[section] ?? {};
  const named = new Set(
    cleanText(codes, 200)
      .split(",")
      .flatMap((code) => mapping[code.trim()] ?? []),
  );
  const allowed = rule.outcomes.filter((o) => named.has(o));
  const kind = rule.inputKinds[0];
  return allowed.length === 0 && kind !== "measured" && kind !== "text" ? [...rule.outcomes] : allowed;
};

/** One definition's stored content and lifecycle, from a staged row of `table`'s `section`. */
export interface DefinitionValues {
  readonly content: ReturnType<typeof inspectionContentOf>;
  readonly notes: string | null;
  readonly status: "active" | "retired";
}

/** The definition a staged checklist row becomes. Pure. */
export const definitionOf = (section: InspectionSection, row: Readonly<Record<string, unknown>>): DefinitionValues => {
  // Only the limit kinds carry a limit (0112 `limit_kind`); their unit is the limit's.
  const limitText = section === "performance" || section === "electrical_safety" ? textOrNull(row["nilai_acuan"], 100) : null;
  const input: InspectionItemContentInput = {
    section,
    label: cleanText(row["description"], LABEL_MAX),
    inputKind: INSPECTION_SECTION_RULES[section].inputKinds[0] as InspectionItemContentInput["inputKind"],
    unit: parseLimit(limitText)?.unit ?? null,
    symbol: textOrNull(row["symbol"], 50),
    settingText: section === "performance" ? textOrNull(row["setting"], 50) : null,
    limitText,
    allowedOutcomes: outcomesOf(section, row["status"]),
  };
  return {
    content: inspectionContentOf(input),
    notes: textOrNull(row["notes"], 10_000),
    status: BASE_SECTIONS.has(section) ? "retired" : "active",
  };
};

const byLegacyId = (a: StagedCatalogueRow, b: StagedCatalogueRow): number =>
  Number(a.legacyId) - Number(b.legacyId) || a.legacyId.localeCompare(b.legacyId);

/** What the device-type plan writes. */
export interface DeviceTypePlan {
  insert: { id: string; name: string; legacyId: string }[];
  adopt: { id: string; legacyId: string }[];
  rename: { id: string; name: string }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

/**
 * Decide every staged device type. Pure.
 * @param rows - the run's staged `mst_alat` rows
 * @param existing - the device types already holding one of the names (lower-cased name → id)
 * @param newId - a fresh id
 */
export const planDeviceTypes = (rows: readonly StagedCatalogueRow[], existing: ReadonlyMap<string, string>, newId: () => string): DeviceTypePlan => {
  const plan: DeviceTypePlan = { insert: [], adopt: [], rename: [], mappings: [], quarantine: [] };
  const groups = new Map<string, { name: string; members: StagedCatalogueRow[] }>();
  for (const row of [...rows].sort(byLegacyId)) {
    const name = cleanText(row.row["nama_alat"], LABEL_MAX);
    if (name === "") {
      plan.quarantine.push({ sourceTable: DEVICE_TYPE_SOURCE.table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason: "value_out_of_range" });
      continue;
    }
    const key = name.toLowerCase();
    const group = groups.get(key) ?? { name, members: [] };
    group.members.push(row);
    groups.set(key, group);
  }
  for (const [key, { name, members }] of groups) {
    const survivor = members[0] as StagedCatalogueRow;
    let targetId: string;
    if (survivor.targetId !== null && survivor.targetPresent) {
      targetId = survivor.targetId;
      if (survivor.decision === "changed") {
        plan.rename.push({ id: targetId, name });
      }
    } else {
      const adopted = existing.get(key);
      if (adopted === undefined) {
        targetId = newId();
        plan.insert.push({ id: targetId, name, legacyId: survivor.legacyId });
      } else {
        targetId = adopted;
        plan.adopt.push({ id: targetId, legacyId: survivor.legacyId });
      }
    }
    for (const m of members) {
      if (m.decision === "unchanged" && m.targetId === targetId) {
        continue;
      }
      const raw = typeof m.row["nama_alat"] === "string" ? m.row["nama_alat"] : null;
      const values: Record<string, string> = {};
      if (m !== survivor) {
        values["mergedIntoLegacyId"] = survivor.legacyId;
      }
      if (raw !== null && raw !== cleanText(raw, LABEL_MAX)) {
        values["nama_alat"] = raw;
      }
      plan.mappings.push({
        sourceTable: DEVICE_TYPE_SOURCE.table,
        legacyId: m.legacyId,
        targetTable: "device_types",
        targetId,
        tenantId: null,
        clientFacilityId: null,
        rowHash: m.rowHash,
        sourceValues: Object.keys(values).length > 0 ? values : null,
      });
    }
  }
  return plan;
};

/** What the definitions plan writes. */
export interface DefinitionPlan {
  insert: { id: string; table: string; legacyId: string; values: DefinitionValues }[];
  update: { id: string; values: DefinitionValues }[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

/**
 * Decide every staged checklist row of `table`. Pure.
 * @param newId - a fresh id
 */
export const planDefinitions = (table: string, rows: readonly StagedCatalogueRow[], newId: () => string): DefinitionPlan => {
  const plan: DefinitionPlan = { insert: [], update: [], mappings: [], quarantine: [] };
  const section = DEFINITION_TABLES[table] ?? null;
  for (const row of [...rows].sort(byLegacyId)) {
    const quarantine = (reason: QuarantineEntry["reason"]): void => {
      plan.quarantine.push({ sourceTable: table, sourceRowNumber: row.sourceRowNumber, legacyId: row.legacyId, reason });
    };
    if (section === null) {
      quarantine("session_header_value");
      continue;
    }
    const values = definitionOf(section, row.row);
    if (values.content.label === "") {
      quarantine("value_out_of_range");
      continue;
    }
    let targetId: string;
    if (row.targetId !== null && row.targetPresent) {
      targetId = row.targetId;
      if (row.decision === "unchanged") {
        continue;
      }
      plan.update.push({ id: targetId, values });
    } else {
      targetId = newId();
      plan.insert.push({ id: targetId, table, legacyId: row.legacyId, values });
    }
    plan.mappings.push({
      sourceTable: table,
      legacyId: row.legacyId,
      targetTable: "inspection_item_definitions",
      targetId,
      tenantId: null,
      clientFacilityId: null,
      rowHash: row.rowHash,
      sourceValues: null,
    });
  }
  return plan;
};

/** The run's staged rows of `source`, classified, each with its columns and whether its target exists in `target`. */
const readStaged = async (context: StepContext, source: TransformSource, target: "device_types" | "inspection_item_definitions"): Promise<StagedCatalogueRow[]> => {
  const staged = stagedTable(source.table);
  const rows =
    target === "device_types"
      ? await sql<StagedCatalogueRow>(
        context.runner,
        `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision, (t.id IS NOT NULL) AS "targetPresent",
                to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row
           FROM (${classifiedSql(source)}) c
           JOIN ${staged} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
           LEFT JOIN device_types t ON t.id = c."targetId"`,
        [context.runId],
        { transaction: context.transaction },
      )
      : await sql<StagedCatalogueRow>(
        context.runner,
        `SELECT c."sourceRowNumber", c."legacyId", c."rowHash", c."targetId", c.decision, (t.id IS NOT NULL) AS "targetPresent",
                to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row
           FROM (${classifiedSql(source)}) c
           JOIN ${staged} s ON s.import_run_id = $1 AND s.source_row_number = c."sourceRowNumber"::bigint
           LEFT JOIN inspection_item_definitions t ON t.id = c."targetId"`,
        [context.runId],
        { transaction: context.transaction },
      );
  return rows;
};

/** Step 3's `run`: the device types. */
export const runDeviceTypes = async (context: StepContext): Promise<void> => {
  if (!(await stagedTableExists(context, DEVICE_TYPE_SOURCE.table))) {
    return;
  }
  const rows = await readStaged(context, DEVICE_TYPE_SOURCE, "device_types");
  const keys = [...new Set(rows.map((r) => cleanText(r.row["nama_alat"], LABEL_MAX).toLowerCase()).filter((k) => k !== ""))];
  const existing = await sql<{ id: string; key: string }>(
    context.runner,
    "SELECT id, lower(name) AS key FROM device_types WHERE lower(btrim(name)) = ANY($1::text[])",
    [keys],
    { transaction: context.transaction },
  );
  const plan = planDeviceTypes(rows, new Map(existing.map((e) => [e.key, e.id])), randomUUID);
  if (plan.insert.length > 0) {
    await sql(
      context.runner,
      `INSERT INTO device_types (id, name, status, legacy_id, created_at, updated_at)
       SELECT v.id, v.name, 'active', v.legacy, now(), now() FROM unnest($1::uuid[], $2::text[], $3::int[]) AS v(id, name, legacy)`,
      [plan.insert.map((i) => i.id), plan.insert.map((i) => i.name), plan.insert.map((i) => i.legacyId)],
      { transaction: context.transaction },
    );
  }
  if (plan.adopt.length > 0) {
    await sql(
      context.runner,
      `UPDATE device_types t SET legacy_id = coalesce(t.legacy_id, v.legacy), updated_at = now()
         FROM unnest($1::uuid[], $2::int[]) AS v(id, legacy) WHERE t.id = v.id`,
      [plan.adopt.map((a) => a.id), plan.adopt.map((a) => a.legacyId)],
      { transaction: context.transaction },
    );
  }
  if (plan.rename.length > 0) {
    await sql(
      context.runner,
      "UPDATE device_types t SET name = v.name, updated_at = now() FROM unnest($1::uuid[], $2::text[]) AS v(id, name) WHERE t.id = v.id",
      [plan.rename.map((r) => r.id), plan.rename.map((r) => r.name)],
      { transaction: context.transaction },
    );
  }
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
};

/** The 22 bound arrays of a definition write, in the statements' column order. */
const definitionColumns = (rows: readonly { id: string; values: DefinitionValues }[]): (string | null)[][] => {
  const of = (pick: (v: DefinitionValues) => string | null): (string | null)[] => rows.map((r) => pick(r.values));
  return [
    rows.map((r) => r.id),
    of((v) => v.content.section),
    of((v) => v.content.label),
    of((v) => v.content.inputKind),
    of((v) => v.content.unit),
    of((v) => v.content.symbol),
    of((v) => v.content.settingText),
    of((v) => v.content.settingValue),
    of((v) => v.content.limitOp),
    of((v) => v.content.limitValue),
    of((v) => v.content.limitLow),
    of((v) => v.content.limitHigh),
    of((v) => v.content.limitNominal),
    of((v) => v.content.limitTolerance),
    of((v) => v.content.limitText),
    of((v) => v.content.validMin),
    of((v) => v.content.validMax),
    of((v) => v.content.warnMin),
    of((v) => v.content.warnMax),
    // The outcome list travels as one comma-joined text per row (an array of arrays cannot be unnested).
    of((v) => v.content.allowedOutcomes.join(",")),
    of((v) => v.notes),
    of((v) => v.status),
  ];
};

/** Step 4's `run`: the item definitions. */
export const runItemDefinitions = async (context: StepContext): Promise<void> => {
  for (const source of DEFINITION_SOURCES) {
    if (!(await stagedTableExists(context, source.table))) {
      continue;
    }
    const plan = planDefinitions(source.table, await readStaged(context, source, "inspection_item_definitions"), randomUUID);
    if (plan.insert.length > 0) {
      await sql(
        context.runner,
        `INSERT INTO inspection_item_definitions (id, section, label, input_kind, unit, symbol, setting_text, setting_value, limit_op, limit_value,
                                                 limit_low, limit_high, limit_nominal, limit_tolerance, limit_text, valid_min, valid_max, warn_min,
                                                 warn_max, allowed_outcomes, notes, status, default_required, legacy_table, legacy_id,
                                                 created_at, updated_at)
         SELECT v.id, v.section::"enum_inspection_item_definitions_section", v.label, v.kind::"enum_inspection_item_definitions_input_kind",
                v.unit, v.symbol, v.setting_text, v.setting_value::numeric, v.limit_op::"enum_inspection_item_definitions_limit_op",
                v.limit_value::numeric, v.limit_low::numeric, v.limit_high::numeric, v.limit_nominal::numeric, v.limit_tolerance::numeric,
                v.limit_text, v.valid_min::numeric, v.valid_max::numeric, v.warn_min::numeric, v.warn_max::numeric,
                coalesce(string_to_array(nullif(v.outcomes, ''), ','), '{}')::"enum_inspection_item_definitions_allowed_outcomes"[],
                v.notes, v.status::"enum_inspection_item_definitions_status", true, $23, v.legacy, now(), now()
           FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                       $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[],
                       $20::text[], $21::text[], $22::text[], $24::int[])
             AS v(id, section, label, kind, unit, symbol, setting_text, setting_value, limit_op, limit_value, limit_low, limit_high,
                  limit_nominal, limit_tolerance, limit_text, valid_min, valid_max, warn_min, warn_max, outcomes, notes, status, legacy)`,
        [...definitionColumns(plan.insert), source.table, plan.insert.map((i) => i.legacyId)],
        { transaction: context.transaction },
      );
    }
    if (plan.update.length > 0) {
      await sql(
        context.runner,
        `UPDATE inspection_item_definitions d
            SET section = v.section::"enum_inspection_item_definitions_section", label = v.label,
                input_kind = v.kind::"enum_inspection_item_definitions_input_kind", unit = v.unit, symbol = v.symbol,
                setting_text = v.setting_text, setting_value = v.setting_value::numeric,
                limit_op = v.limit_op::"enum_inspection_item_definitions_limit_op", limit_value = v.limit_value::numeric,
                limit_low = v.limit_low::numeric, limit_high = v.limit_high::numeric, limit_nominal = v.limit_nominal::numeric,
                limit_tolerance = v.limit_tolerance::numeric, limit_text = v.limit_text, valid_min = v.valid_min::numeric,
                valid_max = v.valid_max::numeric, warn_min = v.warn_min::numeric, warn_max = v.warn_max::numeric,
                allowed_outcomes = coalesce(string_to_array(nullif(v.outcomes, ''), ','), '{}')::"enum_inspection_item_definitions_allowed_outcomes"[],
                notes = v.notes, status = v.status::"enum_inspection_item_definitions_status", updated_at = now()
           FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                       $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[],
                       $20::text[], $21::text[], $22::text[])
             AS v(id, section, label, kind, unit, symbol, setting_text, setting_value, limit_op, limit_value, limit_low, limit_high,
                  limit_nominal, limit_tolerance, limit_text, valid_min, valid_max, warn_min, warn_max, outcomes, notes, status)
          WHERE d.id = v.id`,
        definitionColumns(plan.update),
        { transaction: context.transaction },
      );
    }
    await quarantineRows(context, plan.quarantine);
    await recordMappings(context, plan.mappings);
  }
};
