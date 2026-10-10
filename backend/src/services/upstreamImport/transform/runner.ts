/**
 * The transform's run (P24-01; ADR-129 § 10 and Amendment 1; docs/UPSTREAM/05 § 1, § 8).
 *
 * ONE transaction on the transform connection (config/upstreamImport.ts#createTransformDb,
 * switched to the transform role of migration 0133):
 *
 *  1. one transform at a time, whatever replica (`pg_advisory_xact_lock`), and proof the
 *     connection is the transform role — not a superuser, able to write `id_map`;
 *  2. the run's earlier quarantine entries are deleted (a re-run REPLACES its quarantine; its
 *     `id_map` rows stay — they are the earlier decisions the hash compares against);
 *  3. every step in 05 § 3.1 order; after each, for every source table it accounts for, the
 *     counts — and a staged row of this run that is neither in `id_map` nor in quarantine fails
 *     the transform `TRANSFORM_INCOMPLETE` (05 § 1.2: "dropped silently" does not exist);
 *  4. a staged table of this run that no step accounts for fails it the same way.
 *
 * A staged table's name reaches a statement only through ledger.ts#stagedTable, which refuses
 * anything off the staging allow-list (ADR-129 Am. 2; reviewed in D-05 and G-14).
 *
 * Any failure rolls back EVERYTHING the steps wrote — the application's rows, `id_map`,
 * quarantine — so a failed transform leaves the database as it was. Counts and codes only: the
 * summary, the error and the log never carry a staged value.
 */
import type { Transaction } from "sequelize";
import type { UpstreamSqlImportTransformErrorCode } from "@callibrator/contracts/upstreamSqlImport";
import { sql, type SqlRunner } from "../../../utils/sql.util";
import { STAGING_SCHEMA } from "../../../config/upstreamImport";
import type { UpstreamSqlImportTransformSummary } from "../../../utils/jsonShape.util";
import { STAGED_TABLES, stagingTableOf } from "../tablePolicy";
import { ID_MAP, QUARANTINE, checkedName, stagedTable } from "./ledger";
import { isBuilt, type StepContext, type TransformSource, type TransformStep } from "./steps";

/** A transform that failed for a stated reason (its code goes on the run). */
export class TransformFailure extends Error {
  readonly code: UpstreamSqlImportTransformErrorCode;

  constructor(code: UpstreamSqlImportTransformErrorCode, message: string) {
    super(message);
    this.name = "TransformFailure";
    this.code = code;
  }
}

/** What the runner needs of the connection: a managed transaction (a Sequelize instance is one). */
export interface TransactionSource {
  transaction<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T>;
}

/** What the run needs. */
export interface TransformOptions {
  readonly runId: string;
  /** The transform connection: its transaction, and the same connection as `sql()`'s runner. */
  readonly db: TransactionSource;
  readonly runner: SqlRunner;
  /** The role the connection must be (config/upstreamImport.ts#transformRoleName). */
  readonly role: string;
  readonly steps: readonly TransformStep[];
  /** A clock, for the durations (tests pass their own). */
  readonly now?: () => number;
}

type SourceSummary = UpstreamSqlImportTransformSummary["steps"][number]["sources"][number];

interface RoleCheck {
  currentUser: string;
  superuser: boolean;
  canMap: boolean;
}

interface SourceCounts {
  staged: number;
  mapped: number;
  unchanged: number;
  unaccounted: number;
}

const LOCK_KEY = `${STAGING_SCHEMA}.transform`;

/** Step 1: serialise, and prove the role. */
const begin = async (context: StepContext, role: string): Promise<void> => {
  const { runner, transaction } = context;
  await sql(runner, "SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY], { transaction });
  const [check] = await sql<RoleCheck>(
    runner,
    `SELECT current_user AS "currentUser", r.rolsuper AS "superuser",
            has_table_privilege($1, 'INSERT') AS "canMap"
       FROM pg_roles r WHERE r.rolname = current_user`,
    [ID_MAP],
    { transaction },
  );
  if (check?.currentUser !== role || check.superuser || !check.canMap) {
    throw new TransformFailure(
      "TRANSFORM_ROLE_INVALID",
      `the transform connection is not the transform role "${role}" able to write ${ID_MAP} (run the migrations; see UPSTREAM_TRANSFORM_DB_ROLE)`,
    );
  }
};

/** Whether the run's staging table of `table` exists. */
const stagedExists = async (context: StepContext, table: string): Promise<boolean> => {
  const [row] = await sql<{ present: boolean }>(
    context.runner,
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`${STAGING_SCHEMA}.${stagingTableOf(checkedName(table))}`],
    { transaction: context.transaction },
  );
  return row?.present === true;
};

/** One source's counts after its step. */
const countSource = async (context: StepContext, source: TransformSource): Promise<SourceSummary & { unaccounted: number }> => {
  const table = checkedName(source.table);
  // Refuses a source off the staging allow-list before any statement names it.
  const staged = stagedTable(table);
  // runTransform ran isBuilt() first: every source has its legacy key.
  const legacyId = source.legacyId as string;
  const quarantined: Record<string, number> = {};
  if (!(await stagedExists(context, table))) {
    return { table, staged: 0, mapped: 0, unchanged: 0, quarantined, unaccounted: 0 };
  }
  const [counts] = await sql<SourceCounts>(
    context.runner,
    `SELECT count(*)::int AS staged,
            count(*) FILTER (WHERE m.import_run_id = $1)::int AS mapped,
            count(*) FILTER (WHERE m.legacy_id IS NOT NULL AND m.import_run_id <> $1)::int AS unchanged,
            count(*) FILTER (WHERE m.legacy_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM ${QUARANTINE} q
               WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.source_row_number = s.source_row_number))::int AS unaccounted
       FROM ${staged} s
       LEFT JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${legacyId})
      WHERE s.import_run_id = $1`,
    [context.runId, table],
    { transaction: context.transaction },
  );
  const reasons = await sql<{ reason: string; n: number }>(
    context.runner,
    `SELECT reason, count(*)::int AS n FROM ${QUARANTINE} WHERE import_run_id = $1 AND source_table = $2 GROUP BY reason ORDER BY reason`,
    [context.runId, table],
    { transaction: context.transaction },
  );
  for (const { reason, n } of reasons) {
    quarantined[reason] = n;
  }
  return {
    table,
    staged: counts?.staged ?? 0,
    mapped: counts?.mapped ?? 0,
    unchanged: counts?.unchanged ?? 0,
    quarantined,
    unaccounted: counts?.unaccounted ?? 0,
  };
};

/**
 * Step 4: a staged table holding rows of this run that no step accounts for. The candidates are
 * the allow-listed tables (tablePolicy.ts STAGED_TABLES) no step claims; the catalogue only says
 * which of them exist, and a name reaches the statement through `stagedTable` (the allow-list),
 * never from the catalogue's text. A `stg_` table OUTSIDE the allow-list cannot hold a row of
 * this run: the load purges the run's rows from every staging table (stagingLoader.ts#purgeRun)
 * and then stages only allow-listed tables (importPipeline.ts, decideTable).
 */
const unclaimedTables = async (context: StepContext, steps: readonly TransformStep[]): Promise<string[]> => {
  const claimed = new Set(steps.flatMap((s) => s.sources.map((source) => source.table)));
  const candidates = [...STAGED_TABLES].filter((table) => !claimed.has(table)).sort();
  const present = await sql<{ name: string }>(
    context.runner,
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])",
    [STAGING_SCHEMA, candidates.map(stagingTableOf)],
    { transaction: context.transaction },
  );
  const existing = new Set(present.map((t) => t.name));
  const unclaimed: string[] = [];
  for (const table of candidates.filter((t) => existing.has(stagingTableOf(t)))) {
    const [row] = await sql<{ present: boolean }>(
      context.runner,
      `SELECT EXISTS (SELECT 1 FROM ${stagedTable(table)} WHERE import_run_id = $1) AS present`,
      [context.runId],
      { transaction: context.transaction },
    );
    if (row?.present === true) {
      unclaimed.push(table);
    }
  }
  return unclaimed;
};

/**
 * Run the transform of one loaded run.
 * @returns the summary (counts per step and source)
 * @throws {TransformFailure} TRANSFORM_NOT_BUILT, TRANSFORM_ROLE_INVALID or TRANSFORM_INCOMPLETE — nothing written;
 *   any other error (a step's SQL) propagates, nothing written
 */
export const runTransform = async (options: TransformOptions): Promise<UpstreamSqlImportTransformSummary> => {
  const { runId, db, runner, role, steps } = options;
  const now = options.now ?? Date.now;
  if (!isBuilt(steps)) {
    throw new TransformFailure("TRANSFORM_NOT_BUILT", "the transform's steps are not built yet (P24-02)");
  }
  const started = now();
  return db.transaction(async (transaction: Transaction) => {
    const context: StepContext = { runId, runner, transaction };
    await begin(context, role);
    await sql(context.runner, `DELETE FROM ${QUARANTINE} WHERE import_run_id = $1`, [runId], { transaction });
    const summary: UpstreamSqlImportTransformSummary = { durationMs: 0, steps: [] };
    for (const step of steps) {
      const stepStarted = now();
      // isBuilt() proved every run is set.
      await (step.run as (c: StepContext) => Promise<void>)(context);
      const counted: SourceSummary[] = [];
      for (const source of step.sources) {
        const { unaccounted, ...counts } = await countSource(context, source);
        if (unaccounted > 0) {
          throw new TransformFailure(
            "TRANSFORM_INCOMPLETE",
            `step ${step.id}: ${String(unaccounted)} staged row(s) of ${source.table} are neither mapped nor quarantined`,
          );
        }
        counted.push(counts);
      }
      summary.steps.push({ step: step.id, durationMs: Math.max(0, now() - stepStarted), sources: counted });
    }
    const unclaimed = await unclaimedTables(context, steps);
    if (unclaimed.length > 0) {
      throw new TransformFailure("TRANSFORM_INCOMPLETE", `no step accounts for the staged table(s) ${unclaimed.join(", ")}`);
    }
    summary.durationMs = Math.max(0, now() - started);
    return summary;
  });
};
