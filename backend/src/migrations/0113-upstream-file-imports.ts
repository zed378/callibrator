/**
 * Migration 0113 — `upstream_file_imports`: the rsync image import's queue (ADR-130;
 * docs/UPSTREAM/08-FILE-POLICY.md).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. the table and its ENUM type `enum_upstream_file_imports_status` unless the table already
 *     exists — db.sync() runs BEFORE the migrations at boot and creates it from the model on a
 *     database that has never seen it, so on that path only 2–4 run;
 *  2. `upstream_file_imports_target_tenant_id_fkey` (→ tenants, ON DELETE CASCADE), which the
 *     model deliberately does not declare (every model reference to `tenants` is the Q-16 tenant
 *     column, and this is not one); and two CHECKs:
 *       `upstream_file_imports_secret_only_while_live` — a terminal row holds no credential
 *       (the erasure is the database's rule too, not only the service's), and
 *       `upstream_file_imports_some_class` — at least one file class;
 *  3. `upstream_file_imports_created_at` (created_at DESC, id DESC) — the queue's only list query;
 *  4. a leading index on each foreign key — `target_tenant_id`, `requested_by`, `batch_job_id`,
 *     `cancelled_by` (the D-20 rule, 0067: deleting the row they reference must not scan this
 *     table).
 *
 * No tenant column (`target_tenant_id`, deliberately not `tenant_id`, so the global hooks never
 * scope the table — a platform operation must not vanish into the tenant it writes to).
 *
 * The CHECKs and the indexes live only here, never on the model: db.sync() never adds either to
 * an existing table (D-13, ADR-100 Am. 3).
 *
 * No try/catch (CLAUDE.md): a failure propagates, the transaction rolls back, and the migration
 * is not recorded as applied. Verify with psql, not the log:
 *   \d upstream_file_imports
 *     -- 29 columns; "upstream_file_imports_secret_only_while_live" and
 *     -- "upstream_file_imports_some_class" CHECK; "upstream_file_imports_target_tenant_id_fkey"
 *     -- (ON DELETE CASCADE); "upstream_file_imports_created_at" btree (created_at DESC, id DESC);
 *     -- one btree per foreign-key column
 *   \dT enum_upstream_file_imports_status
 *
 * Idempotent + reversible (`down` drops the table and its type).
 */
import { DataTypes, type QueryInterface, type Transaction } from "sequelize";
import { UPSTREAM_FILE_IMPORT_STATUSES } from "@callibrator/contracts/states";

const TABLE = "upstream_file_imports";
const ENUM_TYPE = "enum_upstream_file_imports_status";
const TENANT_FK = "upstream_file_imports_target_tenant_id_fkey";
const CHECK_SECRET = "upstream_file_imports_secret_only_while_live";
const CHECK_CLASS = "upstream_file_imports_some_class";
const INDEX_LIST = "upstream_file_imports_created_at";
/** D-20: the foreign-key columns, each with a leading index. */
const FK_COLUMNS = Object.freeze(["target_tenant_id", "requested_by", "batch_job_id", "cancelled_by"]);

const STATEMENTS = Object.freeze({
  tenantFk:
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ${TENANT_FK} FOREIGN KEY (target_tenant_id) ` +
    "REFERENCES tenants (id) ON DELETE CASCADE ON UPDATE CASCADE",
  checkSecret:
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK_SECRET} ` +
    "CHECK (status IN ('pending', 'transferring', 'ingesting') OR secret_ciphertext IS NULL)",
  checkClass: `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK_CLASS} CHECK (include_front OR include_serial)`,
});

const INDEX_SQL = Object.freeze([
  `CREATE INDEX IF NOT EXISTS ${INDEX_LIST} ON ${TABLE} (created_at DESC, id DESC)`,
  ...FK_COLUMNS.map((column) => `CREATE INDEX IF NOT EXISTS ${TABLE}_${column} ON ${TABLE} (${column})`),
]);

const tableExists = async (context: QueryInterface, transaction: Transaction): Promise<boolean> => {
  const [rows] = (await context.sequelize.query(`SELECT to_regclass('${TABLE}') IS NOT NULL AS present`, {
    transaction,
  })) as [{ present: boolean }[], unknown];
  return rows[0]?.present === true;
};

const constraintExists = async (context: QueryInterface, transaction: Transaction, name: string): Promise<boolean> => {
  const [rows] = await context.sequelize.query(
    "SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = :table AND c.conname = :name",
    { replacements: { table: TABLE, name }, transaction },
  );
  return rows.length > 0;
};

const userFk = (): { type: typeof DataTypes.UUID; allowNull: true; references: object; onDelete: string } => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: "users", key: "id" },
  onDelete: "SET NULL",
});

const createTable = (context: QueryInterface, transaction: Transaction): Promise<void> =>
  context.createTable(
    TABLE,
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      // The foreign key is added below (STATEMENTS.tenantFk), for sync() and this path alike.
      target_tenant_id: { type: DataTypes.UUID, allowNull: false },
      requested_by: userFk(),
      batch_job_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "batch_jobs", key: "id" },
        onDelete: "SET NULL",
      },
      status: { type: DataTypes.ENUM(...UPSTREAM_FILE_IMPORT_STATUSES), allowNull: false, defaultValue: "pending" },
      host: { type: DataTypes.STRING(253), allowNull: false },
      port: { type: DataTypes.INTEGER, allowNull: false },
      username: { type: DataTypes.STRING(32), allowNull: false },
      remote_path: { type: DataTypes.STRING(1024), allowNull: false },
      include_front: { type: DataTypes.BOOLEAN, allowNull: false },
      include_serial: { type: DataTypes.BOOLEAN, allowNull: false },
      auth_method: { type: DataTypes.STRING(16), allowNull: false },
      secret_ciphertext: { type: DataTypes.TEXT, allowNull: true },
      secret_erased_at: { type: DataTypes.DATE, allowNull: true },
      host_key_type: { type: DataTypes.STRING(64), allowNull: false },
      host_key: { type: DataTypes.TEXT, allowNull: false },
      host_key_fingerprint: { type: DataTypes.STRING(128), allowNull: false },
      synthetic_source: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      bandwidth_limit_kbps: { type: DataTypes.INTEGER, allowNull: true },
      estimate: { type: DataTypes.JSONB, allowNull: true },
      progress: { type: DataTypes.JSONB, allowNull: true },
      summary: { type: DataTypes.JSONB, allowNull: true },
      error_code: { type: DataTypes.STRING(64), allowNull: true },
      cancel_requested_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_by: userFk(),
      started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    { transaction },
  );

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    if (!(await tableExists(context, transaction))) {
      await createTable(context, transaction);
    }
    const constraints: [string, string][] = [
      [TENANT_FK, STATEMENTS.tenantFk],
      [CHECK_SECRET, STATEMENTS.checkSecret],
      [CHECK_CLASS, STATEMENTS.checkClass],
    ];
    for (const [name, statement] of constraints) {
      if (!(await constraintExists(context, transaction, name))) {
        await context.sequelize.query(statement, { transaction });
      }
    }
    for (const statement of INDEX_SQL) {
      await context.sequelize.query(statement, { transaction });
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`, { transaction });
    await context.sequelize.query(`DROP TYPE IF EXISTS ${ENUM_TYPE}`, { transaction });
  });
};

export = { TABLE, ENUM_TYPE, TENANT_FK, CHECK_SECRET, CHECK_CLASS, INDEX_LIST, FK_COLUMNS, STATEMENTS, INDEX_SQL, up, down };
