/**
 * Migration 0105 — an API key may be the actor of a calibration record, a
 * stock adjustment or a stock transfer request (Q-51, ADR-100 follow-up).
 *
 * WHAT WAS WRONG
 *
 * `calibration_records.performed_by`, `stock_adjustments.adjusted_by` and
 * `stock_transfers.requested_by` are NOT NULL foreign keys to `users`. An API
 * key's principal carries the KEY's id as `req.user.id`
 * (auth.middleware#tryApiKeyAuth), and the services wrote it into those
 * columns: on PostgreSQL the insert failed its foreign key and the write
 * rolled back — a key with `calibration:write` or `warehouse:write` could not
 * perform the writes its scope allowed. (Audit rows were fixed by ADR-100:
 * `system:api-key`.)
 *
 * WHAT THIS DOES — per table
 *
 *  1. (one short transaction) adds `api_key_id UUID REFERENCES api_keys (id)
 *     ON DELETE RESTRICT ON UPDATE CASCADE`, drops NOT NULL on the user
 *     column, and adds CHECK `<name>` = `num_nonnulls(<user column>,
 *     api_key_id) = 1` as NOT VALID — so from that commit on, every NEW row
 *     names exactly one actor. All three steps are catalog-only (the new
 *     column is all NULL; NOT VALID skips the scan), so the ACCESS EXCLUSIVE
 *     lock they take is held for milliseconds, under a lock_timeout.
 *  2. the leading index `<table>_api_key_id` (D-20; the model declares the
 *     same name, so a fresh db.sync() creates it and this is a no-op).
 *  3. (a second transaction) counts the rows that name no actor or both and
 *     REFUSES, naming the count, if there is any — then VALIDATE CONSTRAINT,
 *     which scans under SHARE UPDATE EXCLUSIVE (reads and writes continue).
 *     Every row written before this migration has its user column set (it was
 *     NOT NULL), so the count is 0 on any database that has not been
 *     hand-edited; a non-zero count is a fact to investigate, not to skip.
 *
 * `api_key_id` is RESTRICT, not SET NULL: SET NULL would leave a key-authored
 * row naming no actor, which the CHECK refuses — the key's hard delete would
 * fail anyway, with a less clear error. Keys are revoked by soft delete
 * (`api_keys.is_deleted`, paranoid) and never hard-deleted by the
 * application, so RESTRICT blocks nothing in normal operation; it keeps
 * "which key did this" answerable for as long as the row exists, as
 * RESTRICT on the user column does for a person (F-6, ADR-051 Q-16).
 *
 * NOT here, by decision (Q-51): `calibration_records.voided_by`,
 * `stock_transfers.approved_by` and `stock_opnames.performed_by` stay
 * user-only; the routes that write them refuse an API key (denyApiKey, 403).
 * A void and a transfer approval are decisions on a regulated record that a
 * person answers for, and a void would also need a new lifecycle column in
 * the 0057 append-only trigger and its column grant.
 *
 * `calibration_records` is append-only (0057): the new column is content —
 * not in the trigger's lifecycle list and not in the application role's
 * column-level UPDATE grant — so it is immutable after insert, as
 * performed_by is. The application role's table-level INSERT/SELECT (0057)
 * covers a column added later.
 *
 * No try/catch: a failure propagates and the migration is NOT recorded as
 * applied (CLAUDE.md). A missing table is a refusal, not a skip: the backend
 * runs db.sync() before the migrator. Verify with psql, not the log:
 *   \d stock_adjustments   -- adjusted_by uuid (nullable), api_key_id uuid,
 *                          -- "stock_adjustments_actor_exactly_one" CHECK (num_nonnulls(adjusted_by, api_key_id) = 1)
 *   SELECT conrelid::regclass, conname, convalidated FROM pg_constraint
 *    WHERE conname IN ('calibration_records_actor_exactly_one',
 *                      'stock_adjustments_actor_exactly_one',
 *                      'stock_transfers_requester_exactly_one');  -- convalidated = t
 *
 * Idempotent. Reversible, but DOWN REFUSES while any row names a key: such a
 * row has no user, so NOT NULL could not be restored without inventing one or
 * deleting the row (and calibration_records cannot be deleted at all). Down
 * never discards a key-authored row silently.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";

/** One table whose actor may now be an API key. */
interface Target {
  readonly table: string;
  /** The column that references `users`. */
  readonly userColumn: string;
  readonly check: string;
  readonly index: string;
}

const API_KEY_COLUMN = "api_key_id";
const LOCK_TIMEOUT = "10s";

const target = (table: string, userColumn: string, check: string): Target =>
  Object.freeze({ table, userColumn, check, index: `${table}_${API_KEY_COLUMN}` });

const TARGETS: readonly Target[] = Object.freeze([
  target("calibration_records", "performed_by", "calibration_records_actor_exactly_one"),
  target("stock_adjustments", "adjusted_by", "stock_adjustments_actor_exactly_one"),
  target("stock_transfers", "requested_by", "stock_transfers_requester_exactly_one"),
]);

/** The CHECK's predicate. */
const checkPredicate = (t: Target): string => `num_nonnulls(${t.userColumn}, ${API_KEY_COLUMN}) = 1`;

type Row = Record<string, unknown>;

const rows = async (
  sequelize: Sequelize,
  statement: string,
  replacements: Record<string, unknown>,
  transaction?: Transaction,
): Promise<Row[]> => {
  const [result] = (await sequelize.query(statement, { replacements, ...(transaction ? { transaction } : {}) })) as [
    Row[],
    unknown,
  ];
  return result;
};

/** The one row a catalog or count query returns; its absence is a failure, not a default. */
const first = (result: Row[], statement: string): Row => {
  const [row] = result;
  if (!row) {
    throw new Error(`0105: no row from: ${statement}`);
  }
  return row;
};

const tableExists = async (sequelize: Sequelize, t: Target, transaction?: Transaction): Promise<boolean> => {
  const statement = "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present";
  return first(await rows(sequelize, statement, { table: t.table }, transaction), statement)["present"] === true;
};

const hasColumn = async (sequelize: Sequelize, t: Target, transaction?: Transaction): Promise<boolean> =>
  (
    await rows(
      sequelize,
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { table: t.table, column: API_KEY_COLUMN },
      transaction,
    )
  ).length > 0;

const hasConstraint = async (sequelize: Sequelize, t: Target, transaction?: Transaction): Promise<boolean> =>
  (
    await rows(
      sequelize,
      "SELECT 1 FROM pg_constraint WHERE conrelid = (current_schema() || '.' || :table)::regclass AND conname = :name",
      { table: t.table, name: t.check },
      transaction,
    )
  ).length > 0;

/** Rows naming no actor or both: `num_nonnulls(...) <> 1`. */
const badRowCount = async (sequelize: Sequelize, t: Target, transaction: Transaction): Promise<number> => {
  const statement = `SELECT count(*)::int AS n FROM ${t.table} WHERE NOT (${checkPredicate(t)})`;
  return Number(first(await rows(sequelize, statement, {}, transaction), statement)["n"]);
};

const keyRowCount = async (sequelize: Sequelize, t: Target, transaction: Transaction): Promise<number> => {
  const statement = `SELECT count(*)::int AS n FROM ${t.table} WHERE ${API_KEY_COLUMN} IS NOT NULL`;
  return Number(first(await rows(sequelize, statement, {}, transaction), statement)["n"]);
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  for (const t of TARGETS) {
    if (!(await tableExists(sequelize, t))) {
      throw new Error(
        `0105: table ${t.table} does not exist. Run db.sync() first (the backend does at boot); ` +
          "skipping would record this migration as applied with no actor constraint.",
      );
    }

    // 1. Catalog-only changes, one short transaction.
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      if (!(await hasColumn(sequelize, t, transaction))) {
        await sequelize.query(
          `ALTER TABLE ${t.table} ADD COLUMN ${API_KEY_COLUMN} UUID ` +
            "REFERENCES api_keys (id) ON DELETE RESTRICT ON UPDATE CASCADE",
          { transaction },
        );
      }
      await sequelize.query(`ALTER TABLE ${t.table} ALTER COLUMN ${t.userColumn} DROP NOT NULL`, { transaction });
      if (!(await hasConstraint(sequelize, t, transaction))) {
        await sequelize.query(
          `ALTER TABLE ${t.table} ADD CONSTRAINT ${t.check} CHECK (${checkPredicate(t)}) NOT VALID`,
          { transaction },
        );
      }
    });

    // 2. D-20: the foreign key's leading index.
    await sequelize.query(`CREATE INDEX IF NOT EXISTS ${t.index} ON ${t.table} (${API_KEY_COLUMN})`);

    // 3. Every existing row names exactly one actor — or the migration fails.
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const bad = await badRowCount(sequelize, t, transaction);
      if (bad > 0) {
        throw new Error(
          `0105: ${String(bad)} row(s) of ${t.table} name no actor or both ` +
            `(${t.userColumn} and ${API_KEY_COLUMN}). Constraint ${t.check} cannot be validated; ` +
            "investigate those rows — this migration does not guess an actor.",
        );
      }
      await sequelize.query(`ALTER TABLE ${t.table} VALIDATE CONSTRAINT ${t.check}`, { transaction });
    });
  }
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  // One transaction: all three tables revert, or none does. A key-authored
  // row has no user, so down refuses while one exists; a row written between
  // the count and SET NOT NULL makes SET NOT NULL fail, which rolls back the
  // DROP COLUMN with it — a key id is never discarded silently.
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
    for (const t of TARGETS) {
      if ((await tableExists(sequelize, t, transaction)) && (await hasColumn(sequelize, t, transaction))) {
        const n = await keyRowCount(sequelize, t, transaction);
        if (n > 0) {
          throw new Error(
            `0105 down: ${String(n)} row(s) of ${t.table} were written by an API key and name no user; ` +
              `${t.userColumn} cannot be made NOT NULL again. Refusing — nothing was changed.`,
          );
        }
      }
    }
    for (const t of TARGETS) {
      if (!(await tableExists(sequelize, t, transaction))) {
        continue;
      }
      await sequelize.query(`ALTER TABLE ${t.table} DROP CONSTRAINT IF EXISTS ${t.check}`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${t.index}`, { transaction });
      await sequelize.query(`ALTER TABLE ${t.table} DROP COLUMN IF EXISTS ${API_KEY_COLUMN}`, { transaction });
      await sequelize.query(`ALTER TABLE ${t.table} ALTER COLUMN ${t.userColumn} SET NOT NULL`, { transaction });
    }
  });
};

export = { TARGETS, API_KEY_COLUMN, checkPredicate, up, down };
