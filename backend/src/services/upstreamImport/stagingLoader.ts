/**
 * The SQL-dump import's writes into the staging schema (ADR-129, P24-06).
 *
 * Every statement runs on the STAGING connection (config/upstreamImport.ts —
 * switched to the import role), inside the run's one transaction, through
 * `sql()` with every value BOUND. Identifiers cannot be bound: the schema is
 * a constant, a table name comes from the fixed allow-list of tablePolicy.ts,
 * and a column name only ever matches `^[a-z_][a-z0-9_]{0,62}$` (the parser
 * refuses any other) and is double-quoted besides.
 *
 * A staging table is `upstream_import.stg_<table>`: `import_run_id`,
 * `source_row_number`, then the dump's columns with their staging types
 * (stagingValues.ts), primary key (import_run_id, source_row_number). A later
 * dump that adds a column adds it (nullable); one that changes a column's type
 * makes that table `schema_conflict` for the run — its rows are counted, not
 * loaded — rather than altering what an earlier run staged.
 */
import type { Transaction } from "sequelize";
import { sql, type BindValue, type SqlRunner } from "../../utils/sql.util";
import { STAGING_SCHEMA } from "../../config/upstreamImport";
import type { StagingType } from "./stagingValues";

/** The run's staging connection and its transaction. */
export interface StagingSession {
  readonly runner: SqlRunner;
  readonly transaction: Transaction;
}

/** One staged column. */
export interface StagingColumn {
  readonly name: string;
  readonly type: StagingType;
}

/** One row, its values in the column order of `insertRows`'s columns. */
export interface StagingRow {
  readonly rowNumber: number;
  readonly values: readonly (string | Buffer | null)[];
}

/** PostgreSQL's spelling of each staging type (`format_type`). */
const FORMATTED: Readonly<Record<StagingType, string>> = {
  smallint: "smallint",
  integer: "integer",
  bigint: "bigint",
  numeric: "numeric",
  "double precision": "double precision",
  date: "date",
  timestamp: "timestamp without time zone",
  text: "text",
  bytea: "bytea",
};

/** PostgreSQL binds at most 65,535 parameters per statement; a batch stays well under. */
const MAX_PARAMETERS = 30_000;
const MAX_BATCH_ROWS = 1000;

const quoted = (identifier: string): string => `"${identifier}"`;
const qualified = (table: string): string => `${STAGING_SCHEMA}.${quoted(table)}`;

/** What the staging connection is, as the run checks it before writing anything. */
export interface RoleCheck {
  currentUser: string;
  superuser: boolean;
  canCreate: boolean;
}

/**
 * Serialise runs (one at a time, whatever replica) and prove the connection
 * is the import role — not a superuser, able to create in the schema.
 * @throws {Error} naming what is wrong; nothing has been written
 */
export const beginStaging = async (session: StagingSession, role: string): Promise<void> => {
  const { runner, transaction } = session;
  await sql(runner, "SELECT pg_advisory_xact_lock(hashtext($1))", [STAGING_SCHEMA], { transaction });
  const [check] = await sql<RoleCheck>(
    runner,
    `SELECT current_user AS "currentUser", r.rolsuper AS "superuser",
            has_schema_privilege($1, 'CREATE') AS "canCreate"
       FROM pg_roles r WHERE r.rolname = current_user`,
    [STAGING_SCHEMA],
    { transaction },
  );
  if (check?.currentUser !== role || check.superuser || !check.canCreate) {
    throw new Error(
      `the staging connection is not the import role "${role}" with CREATE on ${STAGING_SCHEMA} ` +
        "(run the migrations; see UPSTREAM_IMPORT_DB_ROLE)",
    );
  }
};

/**
 * Delete every row this run staged before — a re-run REPLACES its rows.
 * @returns the staging tables that exist
 */
export const purgeRun = async (session: StagingSession, runId: string): Promise<string[]> => {
  const { runner, transaction } = session;
  const tables = await sql<{ name: string }>(
    runner,
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 AND tablename LIKE 'stg\\_%' ORDER BY tablename",
    [STAGING_SCHEMA],
    { transaction },
  );
  for (const { name } of tables) {
    await sql(runner, `DELETE FROM ${qualified(name)} WHERE import_run_id = $1`, [runId], { transaction });
  }
  return tables.map((t) => t.name);
};

/**
 * Create the staging table when absent and add the columns it lacks.
 * @returns "ok", or "schema_conflict" when an existing column has another type
 */
export const prepareTable = async (session: StagingSession, table: string, columns: readonly StagingColumn[]): Promise<"ok" | "schema_conflict"> => {
  const { runner, transaction } = session;
  const definitions = columns.map((c) => `${quoted(c.name)} ${c.type}, `).join("");
  await sql(
    runner,
    `CREATE TABLE IF NOT EXISTS ${qualified(table)} (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL, ${definitions}PRIMARY KEY (import_run_id, source_row_number))`,
    [],
    { transaction },
  );
  const existing = await sql<{ name: string; type: string }>(
    runner,
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`,
    [`${STAGING_SCHEMA}.${table}`],
    { transaction },
  );
  const types = new Map(existing.map((c) => [c.name, c.type]));
  if (columns.some((c) => types.has(c.name) && types.get(c.name) !== FORMATTED[c.type])) {
    return "schema_conflict";
  }
  for (const column of columns.filter((c) => !types.has(c.name))) {
    await sql(runner, `ALTER TABLE ${qualified(table)} ADD COLUMN ${quoted(column.name)} ${column.type}`, [], { transaction });
  }
  return "ok";
};

/** How many rows one INSERT carries for a table of `columnCount` columns. */
export const batchSize = (columnCount: number): number =>
  Math.max(1, Math.min(MAX_BATCH_ROWS, Math.floor(MAX_PARAMETERS / (columnCount + 2))));

/**
 * Insert rows with bound values, `batchSize` rows per statement.
 * @param columns - the staged columns, in the order of each row's values
 */
export const insertRows = async (
  session: StagingSession,
  table: string,
  runId: string,
  columns: readonly StagingColumn[],
  rows: readonly StagingRow[],
): Promise<void> => {
  const { runner, transaction } = session;
  const names = ["import_run_id", "source_row_number", ...columns.map((c) => c.name)].map(quoted).join(", ");
  const size = batchSize(columns.length);
  for (let start = 0; start < rows.length; start += size) {
    const batch = rows.slice(start, start + size);
    const bind: BindValue[] = [];
    const tuples = batch.map((row) => {
      const first = bind.length + 1;
      bind.push(runId, row.rowNumber, ...row.values);
      return `(${Array.from({ length: columns.length + 2 }, (_, i) => `$${String(first + i)}`).join(", ")})`;
    });
    await sql(runner, `INSERT INTO ${qualified(table)} (${names}) VALUES ${tuples.join(", ")}`, bind, { transaction });
  }
};
