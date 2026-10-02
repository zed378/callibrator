/**
 * Migration 0107 — work orders store their schedule, costs and resolution
 * (Q-55, ADR-097 Amendment 4).
 *
 * `POST /maintenance` and `PATCH /maintenance/:orderId` accepted
 * `scheduledDate`, `completedDate`, `estimatedCost`, `actualCost` and
 * `resolutionNotes` (packages/contracts/src/maintenance.ts), but
 * `maintenance_work_orders` had no such columns and the model no such
 * attributes, so Sequelize dropped them and the 200 said otherwise. The
 * working decision on Q-55 is to STORE them: a hospital work order needs its
 * schedule, its cost and how the device was returned to service.
 *
 * Columns (the model's own definitions; the model uses `underscored: true`):
 *   scheduled_date    TIMESTAMPTZ   (DataTypes.DATE: the model's date convention)
 *   completed_date    TIMESTAMPTZ
 *   estimated_cost    NUMERIC(14,2) CHECK (estimated_cost >= 0)
 *   actual_cost       NUMERIC(14,2) CHECK (actual_cost >= 0)
 *   resolution_notes  TEXT          CHECK (char_length(resolution_notes) <= 5000)
 * The bounds are also the contract's, so a client gets a 400 before the
 * database could refuse anything. No index: nothing filters or orders on these
 * columns, and an unused index is write cost (ADR-100 Am. 3).
 *
 * The CHECKs are added whether or not the columns already exist: on a FRESH
 * database `db.sync()` has created the columns from the model (sync never
 * creates a CHECK), on an upgraded one this migration adds them. Each CHECK is
 * added NOT VALID and then validated, so a bad existing value fails the
 * migration loudly instead of being guessed at.
 *
 * No blanket try/catch: a missing table fails the migration (it runs after
 * db.sync(), as 0105 does), and it is NOT recorded as applied. Verify with
 * psql, not the log:
 *   \d maintenance_work_orders
 *
 * Idempotent; reversible (down drops exactly these CHECKs and columns).
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";

const TABLE = "maintenance_work_orders";
const LOCK_TIMEOUT = "10s";

/** Column -> its SQL type. The model declares the same (tests/migrations/0107 holds them equal). */
const COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  scheduled_date: "TIMESTAMP WITH TIME ZONE",
  completed_date: "TIMESTAMP WITH TIME ZONE",
  estimated_cost: "NUMERIC(14,2)",
  actual_cost: "NUMERIC(14,2)",
  resolution_notes: "TEXT",
});

/** CHECK name -> predicate. */
const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  maintenance_work_orders_estimated_cost_nonnegative: "estimated_cost >= 0",
  maintenance_work_orders_actual_cost_nonnegative: "actual_cost >= 0",
  maintenance_work_orders_resolution_notes_length: "char_length(resolution_notes) <= 5000",
});

type Row = Record<string, unknown>;

const rows = async (
  sequelize: Sequelize,
  statement: string,
  replacements: Record<string, unknown>,
  transaction: Transaction,
): Promise<Row[]> => {
  const [result] = (await sequelize.query(statement, { replacements, transaction })) as [Row[], unknown];
  return result;
};

const tableExists = async (sequelize: Sequelize, transaction: Transaction): Promise<boolean> => {
  const [row] = await rows(
    sequelize,
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { table: TABLE },
    transaction,
  );
  return row?.["present"] === true;
};

const existingColumns = async (sequelize: Sequelize, transaction: Transaction): Promise<Set<string>> =>
  new Set(
    (
      await rows(
        sequelize,
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table",
        { table: TABLE },
        transaction,
      )
    ).map((r) => String(r["column_name"])),
  );

const existingChecks = async (sequelize: Sequelize, transaction: Transaction): Promise<Set<string>> =>
  new Set(
    (
      await rows(
        sequelize,
        "SELECT conname FROM pg_constraint WHERE conrelid = (current_schema() || '.' || :table)::regclass",
        { table: TABLE },
        transaction,
      )
    ).map((r) => String(r["conname"])),
  );

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
    if (!(await tableExists(sequelize, transaction))) {
      throw new Error(
        `0107: table ${TABLE} does not exist. Run db.sync() first (the backend does at boot); ` +
          "skipping would record this migration as applied with no columns.",
      );
    }
    const columns = await existingColumns(sequelize, transaction);
    for (const [column, type] of Object.entries(COLUMNS)) {
      if (!columns.has(column)) {
        await sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN ${column} ${type}`, { transaction });
      }
    }
    const checks = await existingChecks(sequelize, transaction);
    for (const [name, predicate] of Object.entries(CHECKS)) {
      if (!checks.has(name)) {
        await sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (${predicate}) NOT VALID`, { transaction });
      }
      // Fails the migration (and rolls it back) if an existing value breaks the bound.
      await sequelize.query(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${name}`, { transaction });
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
    if (!(await tableExists(sequelize, transaction))) {
      return;
    }
    for (const name of Object.keys(CHECKS)) {
      await sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${name}`, { transaction });
    }
    for (const column of Object.keys(COLUMNS)) {
      await sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${column}`, { transaction });
    }
  });
};

export = { TABLE, COLUMNS, CHECKS, up, down };
