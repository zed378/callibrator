/**
 * The transform's bookkeeping (P24-01; docs/UPSTREAM/05 § 3.5, § 4, § 8): what a step uses to
 * decide a staged row (new, unchanged, changed) and to record the decision in
 * `upstream_import.id_map` or `upstream_import.quarantine` (migration 0133).
 *
 * Every statement goes through `sql()` on the transform connection, inside the run's one
 * transaction, with every VALUE bound. Identifiers cannot be bound: the schema is a constant,
 * a staged table is interpolated ONLY when it is on the staging allow-list (tablePolicy.ts
 * STAGED_TABLES, which the step registry covers exactly — `transformSteps.p2401`), and is
 * double-quoted besides; a legacy-key expression comes from steps.ts (code, never input).
 * That is why D-05 and G-14 list this file as reviewed (ADR-129 Am. 2).
 *
 * THE ROW HASH (05 § 4, § 8). `source_row_hash` is the SHA-256 of the staged row's canonical
 * text, computed by PostgreSQL: the row as JSONB without `import_run_id` and
 * `source_row_number`, NULL members stripped (so a later dump that adds an empty column changes
 * no hash), in JSONB's own text form (keys ordered, one spelling per value). Same hash as the
 * `id_map` row → the step skips the row; another → it updates a mutable target or
 * voids-and-supersedes an append-only one (P24-02).
 */
import type { UpstreamImportQuarantineReason } from "@callibrator/contracts/upstreamSqlImport";
import { sql, type BindValue } from "../../../utils/sql.util";
import { STAGING_SCHEMA } from "../../../config/upstreamImport";
import { STAGED_TABLES, stagingTableOf } from "../tablePolicy";
import type { StepContext, TransformSource } from "./steps";

const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const ALIAS = /^[a-z][a-z0-9_]{0,30}$/;

/** `upstream_import.id_map`. */
export const ID_MAP = `${STAGING_SCHEMA}.id_map`;
/** `upstream_import.quarantine`. */
export const QUARANTINE = `${STAGING_SCHEMA}.quarantine`;

/** Rows per bound INSERT (9 parameters each, well under PostgreSQL's 65,535). */
const BATCH_ROWS = 1000;

/**
 * A table name checked against the identifier pattern.
 * @throws {Error} when it is not a plain lower-case identifier
 */
export const checkedName = (name: string): string => {
  if (!NAME.test(name)) {
    throw new Error(`upstream transform: "${name}" is not a plain lower-case table name`);
  }
  return name;
};

const STAGED: ReadonlySet<string> = new Set(STAGED_TABLES);

/**
 * `upstream_import."stg_<table>"` — the only way a staged table's name reaches a statement's text.
 * @throws {Error} when `table` is not on the staging allow-list (tablePolicy.ts STAGED_TABLES)
 */
export const stagedTable = (table: string): string => {
  if (!STAGED.has(checkedName(table))) {
    throw new Error(`upstream transform: "${table}" is not a staged table (tablePolicy.ts)`);
  }
  return `${STAGING_SCHEMA}."${stagingTableOf(table)}"`;
};

/**
 * The SQL expression of a staged row's `source_row_hash` (lower-case hex SHA-256).
 * @param alias - the staged row's alias in the statement
 */
export const rowHashSql = (alias: string): string => {
  if (!ALIAS.test(alias)) {
    throw new Error(`upstream transform: "${alias}" is not a plain alias`);
  }
  return `encode(sha256(convert_to((jsonb_strip_nulls(to_jsonb(${alias}) - 'import_run_id' - 'source_row_number'))::text, 'UTF8')), 'hex')`;
};

/** A staged row's decision. */
export type RowDecision = "new" | "unchanged" | "changed";

/** One classified staged row. */
export interface ClassifiedRow {
  sourceRowNumber: string;
  legacyId: string;
  rowHash: string;
  /** The current mapping's target, when the row was mapped before. */
  targetId: string | null;
  decision: RowDecision;
}

/**
 * A SELECT of the run's staged rows of `source`, each with its legacy id, its hash, its earlier
 * target and its decision. `$1` is the run id. A step reads it as a subquery for set-based
 * work, or through `classify` row by row.
 * @throws {Error} when the source has no legacy key yet (P24-02 writes it)
 */
export const classifiedSql = (source: TransformSource): string => {
  if (source.legacyId === null) {
    throw new Error(`upstream transform: ${source.table} has no legacy key yet`);
  }
  return `SELECT s.source_row_number::text AS "sourceRowNumber", k.legacy_id AS "legacyId", k.row_hash AS "rowHash",
       m.target_id AS "targetId",
       CASE WHEN m.legacy_id IS NULL THEN 'new' WHEN m.source_row_hash = k.row_hash THEN 'unchanged' ELSE 'changed' END AS decision
  FROM ${stagedTable(source.table)} s
 CROSS JOIN LATERAL (SELECT (${source.legacyId}) AS legacy_id, ${rowHashSql("s")} AS row_hash) k
  LEFT JOIN ${ID_MAP} m ON m.source_table = '${checkedName(source.table)}' AND m.legacy_id = k.legacy_id
 WHERE s.import_run_id = $1`;
};

/**
 * The run's staged rows of `source`, classified, in staged order.
 * @returns the rows
 */
export const classify = (context: StepContext, source: TransformSource): Promise<ClassifiedRow[]> =>
  sql<ClassifiedRow>(context.runner, `${classifiedSql(source)} ORDER BY s.source_row_number`, [context.runId], {
    transaction: context.transaction,
  });

/** One mapping to record. */
export interface Mapping {
  sourceTable: string;
  legacyId: string;
  targetTable: string;
  targetId: string;
  tenantId: string | null;
  /** The facility the transform DECIDED (AM-28); RC-F1 compares it with what landed. */
  clientFacilityId: string | null;
  rowHash: string;
  /** Only the raw values the transform changed; never for `users` (the table's CHECK refuses it). */
  sourceValues: Readonly<Record<string, string | number | boolean | null>> | null;
}

/**
 * Record mappings: a new key is inserted; an existing key is moved to this run, its target,
 * tenant, facility, hash and values replaced (05 § 8: the current mapping; a superseded target
 * is reachable through the target's own supersede chain).
 * @returns how many rows were written
 */
export const recordMappings = async (context: StepContext, mappings: readonly Mapping[]): Promise<number> => {
  for (let start = 0; start < mappings.length; start += BATCH_ROWS) {
    const batch = mappings.slice(start, start + BATCH_ROWS);
    const bind: BindValue[] = [];
    const tuples = batch.map((m) => {
      const first = bind.length + 1;
      bind.push(
        checkedName(m.sourceTable),
        m.legacyId,
        checkedName(m.targetTable),
        m.targetId,
        m.tenantId,
        m.clientFacilityId,
        context.runId,
        m.rowHash,
        m.sourceValues === null ? null : JSON.stringify(m.sourceValues),
      );
      const p = (i: number): string => `$${String(first + i)}`;
      return `(${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}::uuid, ${p(4)}::uuid, ${p(5)}::uuid, ${p(6)}::uuid, ${p(7)}, ${p(8)}::jsonb)`;
    });
    await sql(
      context.runner,
      `INSERT INTO ${ID_MAP} (source_table, legacy_id, target_table, target_id, tenant_id, client_facility_id, import_run_id, source_row_hash, source_values)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (source_table, legacy_id) DO UPDATE SET
         target_table = EXCLUDED.target_table, target_id = EXCLUDED.target_id, tenant_id = EXCLUDED.tenant_id,
         client_facility_id = EXCLUDED.client_facility_id, import_run_id = EXCLUDED.import_run_id,
         source_row_hash = EXCLUDED.source_row_hash, source_values = EXCLUDED.source_values, updated_at = now()`,
      bind,
      { transaction: context.transaction },
    );
  }
  return mappings.length;
};

/** One staged row put in quarantine. */
export interface QuarantineEntry {
  sourceTable: string;
  sourceRowNumber: string | number;
  legacyId: string | null;
  reason: UpstreamImportQuarantineReason;
}

/**
 * Quarantine staged rows of this run (codes only; the row's values stay in staging). The same
 * row and reason twice is one entry.
 * @returns how many entries were given
 */
export const quarantineRows = async (context: StepContext, entries: readonly QuarantineEntry[]): Promise<number> => {
  for (let start = 0; start < entries.length; start += BATCH_ROWS) {
    const batch = entries.slice(start, start + BATCH_ROWS);
    const bind: BindValue[] = [];
    const tuples = batch.map((e) => {
      const first = bind.length + 1;
      bind.push(context.runId, checkedName(e.sourceTable), String(e.sourceRowNumber), e.legacyId, e.reason);
      const p = (i: number): string => `$${String(first + i)}`;
      return `(${p(0)}::uuid, ${p(1)}, ${p(2)}::bigint, ${p(3)}, ${p(4)})`;
    });
    await sql(
      context.runner,
      `INSERT INTO ${QUARANTINE} (import_run_id, source_table, source_row_number, legacy_id, reason)
       VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`,
      bind,
      { transaction: context.transaction },
    );
  }
  return entries.length;
};
