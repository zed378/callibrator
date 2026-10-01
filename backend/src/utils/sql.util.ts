/**
 * P9-07 — the ONE way application code runs raw SQL: bind parameters only.
 *
 * Raw SQL bypasses the global tenant hooks entirely (CLAUDE.md, Non-Negotiables;
 * docs/ENGINEERING/07 § Raw SQL). Two defects this shape rules out:
 *
 *  - `$1` placeholders passed as `replacements`. Sequelize substitutes only `?`
 *    and `:name` from replacements, so PostgreSQL answered "there is no
 *    parameter $1" — which, behind a catch, read every tenant's metered usage as
 *    zero in production (ADR-039). Here `replacements` cannot be passed: not by
 *    type, and not at run time either (a JavaScript caller gets a TypeError).
 *  - a value interpolated into the statement. Values go in `bind`; the statement
 *    is a constant. Identifiers, where one must vary, come from a fixed allow-list.
 *
 * Every raw statement that touches tenant data carries its tenant predicate
 * EXPLICITLY, as a bound parameter (`tenant_id = $n`): the hooks are not there.
 * tests/utils/rawSqlTenantPredicate.d05.test.js reads every `sql(...)` call and
 * enforces that for statements naming a tenant-scoped table.
 *
 * `sql<Row>(runner, text, bind, options)` resolves with the rows (a SELECT, or a
 * statement with RETURNING). The runner is the Sequelize instance — passed in,
 * as every raw-SQL module already receives or requires it — or anything with the
 * same `query`, which is what the unit tests pass. `Row` is the caller's claim
 * about the row shape (the driver checks nothing); `sql<any>` is a lint error
 * (`no-explicit-any`), and `Row` must be an object type.
 *
 * Direct `sequelize.query` / `db.query` in a TypeScript source file is a lint
 * error outside this module (backend/eslint.config.js). JavaScript call sites
 * move to this helper as their modules convert (Stage C).
 */
import type { Transaction } from "sequelize";

/** A value PostgreSQL can bind (node-postgres serialises arrays and Buffers). */
export type BindValue =
  | string
  | number
  | bigint
  | boolean
  | Date
  | Buffer
  | null
  | readonly BindValue[];

/** The options this helper passes to `query` — `type: "SELECT"` always; `bind` and `transaction` only when given. */
export interface SqlQueryOptions {
  type: "SELECT";
  bind?: readonly BindValue[];
  transaction?: Transaction;
}

/** What `sql` needs from its runner: a Sequelize instance, or a test double with the same `query`. */
export interface SqlRunner {
  query(text: string, options: SqlQueryOptions): Promise<unknown>;
}

/** Per-call options. There is deliberately no `replacements`. */
export interface SqlOptions {
  /** Run inside this transaction (otherwise Sequelize's CLS transaction, if any, applies as before). */
  transaction?: Transaction;
}

/** Quoted string literals, so a `$1` inside one is not taken for a placeholder. */
const STRING_LITERAL = /'(?:[^']|'')*'/g;
const PLACEHOLDER = /\$(\d+)/g;

/**
 * The highest `$n` placeholder a statement names (0 when it names none).
 * @param text - the SQL statement
 * @returns the largest n
 */
export const highestPlaceholder = (text: string): number => {
  let highest = 0;
  for (const match of text
    .replace(STRING_LITERAL, "''")
    .matchAll(PLACEHOLDER)) {
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
};

/**
 * Runs one raw statement with bind parameters and resolves with its rows.
 * @param runner - the Sequelize instance (or a double with the same `query`)
 * @param text - a constant SQL statement using `$1…$n` placeholders
 * @param bind - the values for `$1…$n`, in order
 * @param options - `{ transaction }`
 * @returns the rows, typed as the caller's `Row`
 * @throws TypeError when `replacements` is passed, or the statement names a `$n` with no bound value
 */
export const sql = async <Row extends object>(
  runner: SqlRunner,
  text: string,
  bind: readonly BindValue[] = [],
  options: SqlOptions = {},
): Promise<Row[]> => {
  if (Object.prototype.hasOwnProperty.call(options, "replacements")) {
    throw new TypeError(
      "sql(): `replacements` cannot be passed — use $1…$n placeholders and `bind` (P9-07, ADR-039)",
    );
  }
  const highest = highestPlaceholder(text);
  if (highest > bind.length) {
    throw new TypeError(
      `sql(): the statement names $${String(highest)} but ${String(bind.length)} bind value(s) were passed (P9-07)`,
    );
  }
  const queryOptions: SqlQueryOptions = { type: "SELECT" };
  if (bind.length > 0) {
    queryOptions.bind = bind;
  }
  if (options.transaction) {
    queryOptions.transaction = options.transaction;
  }
  // The one assertion: the rows are the caller's declared shape (the driver does not check).
  return (await runner.query(text, queryOptions)) as Row[];
};
