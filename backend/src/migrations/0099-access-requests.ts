/**
 * P10-05 (ADR-098 §6) — `access_requests`: the public intake's requests and
 * the super admin's queue (spec MEMORY/specs/P10-05-request-access.md).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. the table (with its four ENUM types, `enum_access_requests_<column>`,
 *     the names Sequelize gives them) unless it already exists — db.sync()
 *     runs BEFORE the migrations at boot and creates it from the model on a
 *     database that has never seen it, so on that path only 2–4 run;
 *  2. `access_requests_decided_iff_not_pending` (BR-P10-3): `decided_at` is set
 *     if and only if the request is no longer `pending`; and
 *     `access_requests_provisioned_tenant_id_fkey` (→ tenants, ON DELETE SET
 *     NULL), which the model deliberately does not declare;
 *  3. `access_requests_status_created_at` (status, created_at DESC) — the
 *     queue's only query — and `access_requests_work_email`, for grouping a
 *     requester's duplicates;
 *  4. a leading index on each foreign key — `admin_user_id`, `decided_by`,
 *     `provisioned_tenant_id` (the D-20 rule, 0067: a delete of the user or
 *     tenant they reference must not scan this table);
 *  5. `access_requests_invitation_token_hash_unique`, partial (NOT NULL): the
 *     P10-15 invitation is found by its hash. A unique random hash is no
 *     existence oracle — nobody can present another requester's token.
 *
 * NOT here, on purpose: a unique `work_email`. It would answer "this address
 * already asked" to anyone (an oracle); duplicates are allowed and grouped.
 * No tenant column: a request precedes any tenant (the tenant it created is
 * `provisioned_tenant_id`, deliberately not `tenant_id`, so the global hooks
 * never scope the table).
 *
 * The CHECK and the indexes live only here, never on the model: db.sync()
 * never adds either to an existing table (D-13, as 0093/0096).
 *
 * No try/catch (CLAUDE.md): a failure propagates, the transaction rolls back,
 * and the migration is not recorded as applied. Verify with psql, not the log:
 *   \d access_requests
 *     -- 25 columns; "access_requests_decided_iff_not_pending" CHECK;
 *     -- "access_requests_status_created_at" btree (status, created_at DESC);
 *     -- "access_requests_work_email" btree (work_email);
 *     -- "access_requests_admin_user_id", "access_requests_decided_by",
 *     --   "access_requests_provisioned_tenant_id" btree;
 *     -- "access_requests_invitation_token_hash_unique" UNIQUE, btree
 *     --   (invitation_token_hash) WHERE invitation_token_hash IS NOT NULL
 *   \dT enum_access_requests_*
 *
 * Idempotent + reversible (`down` drops the table and its four types).
 */
import { DataTypes, type QueryInterface, type Transaction } from "sequelize";
import {
  ACCESS_REQUEST_STATUSES,
  DEVICE_COUNT_BANDS,
  FACILITY_TYPES,
  REQUEST_LOCALES,
} from "../constants/accessRequest";

const TABLE = "access_requests";
const CHECK = "access_requests_decided_iff_not_pending";
const INDEX_QUEUE = "access_requests_status_created_at";
const INDEX_EMAIL = "access_requests_work_email";
const INDEX_INVITATION = "access_requests_invitation_token_hash_unique";
const ENUM_TYPES = Object.freeze([
  "enum_access_requests_facility_type",
  "enum_access_requests_device_count_band",
  "enum_access_requests_locale",
  "enum_access_requests_status",
]);

/**
 * The link to the tenant an approval created. Not declared on the model (every
 * model reference to `tenants` is a Q-16 tenant column), so db.sync() does not
 * create it: added here on both paths. SET NULL: the request outlives a
 * tenant's offboarding as history.
 */
const TENANT_FK = "access_requests_provisioned_tenant_id_fkey";
const TENANT_FK_SQL =
  `ALTER TABLE ${TABLE} ADD CONSTRAINT ${TENANT_FK} FOREIGN KEY (provisioned_tenant_id) ` +
  "REFERENCES tenants (id) ON DELETE SET NULL ON UPDATE CASCADE";

const ADD_CHECK_SQL =
  `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK} ` +
  "CHECK ((status = 'pending') = (decided_at IS NULL))";
/** D-20: the foreign-key columns, each with a leading index (Sequelize's default name). */
const FK_COLUMNS = Object.freeze(["admin_user_id", "decided_by", "provisioned_tenant_id"]);
const INDEX_SQL = Object.freeze([
  `CREATE INDEX IF NOT EXISTS ${INDEX_QUEUE} ON ${TABLE} (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ${INDEX_EMAIL} ON ${TABLE} (work_email)`,
  ...FK_COLUMNS.map((column) => `CREATE INDEX IF NOT EXISTS ${TABLE}_${column} ON ${TABLE} (${column})`),
  `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_INVITATION} ON ${TABLE} (invitation_token_hash) ` +
    "WHERE invitation_token_hash IS NOT NULL",
]);

const tableExists = async (context: QueryInterface, transaction: Transaction): Promise<boolean> => {
  const [rows] = (await context.sequelize.query(`SELECT to_regclass('${TABLE}') IS NOT NULL AS present`, {
    transaction,
  })) as [{ present: boolean }[], unknown];
  return rows[0]?.present === true;
};

const constraintExists = async (context: QueryInterface, transaction: Transaction, name: string): Promise<boolean> => {
  const [rows] = await context.sequelize.query(
    "SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid " +
      "WHERE t.relname = :table AND c.conname = :name",
    { replacements: { table: TABLE, name }, transaction },
  );
  return rows.length > 0;
};

const fk = (table: string): { type: typeof DataTypes.UUID; allowNull: true; references: object; onDelete: string } => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: table, key: "id" },
  onDelete: "SET NULL",
});

const createTable = (context: QueryInterface, transaction: Transaction): Promise<void> =>
  context.createTable(
    TABLE,
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      organisation_name: { type: DataTypes.STRING(160), allowNull: false },
      facility_type: { type: DataTypes.ENUM(...FACILITY_TYPES), allowNull: false },
      city: { type: DataTypes.STRING(80), allowNull: false },
      device_count_band: { type: DataTypes.ENUM(...DEVICE_COUNT_BANDS), allowNull: false },
      contact_name: { type: DataTypes.STRING(120), allowNull: false },
      contact_role: { type: DataTypes.STRING(80), allowNull: true },
      work_email: { type: DataTypes.STRING(254), allowNull: false },
      whatsapp: { type: DataTypes.STRING(20), allowNull: false },
      needs: { type: DataTypes.TEXT, allowNull: true },
      locale: { type: DataTypes.ENUM(...REQUEST_LOCALES), allowNull: false },
      consent_version: { type: DataTypes.STRING(32), allowNull: false },
      consented_at: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.ENUM(...ACCESS_REQUEST_STATUSES), allowNull: false, defaultValue: "pending" },
      admin_user_id: fk("users"),
      decided_by: fk("users"),
      decided_at: { type: DataTypes.DATE, allowNull: true },
      decision_note: { type: DataTypes.STRING(1000), allowNull: true },
      // The foreign key is added below (TENANT_FK_SQL), for sync() and this path alike.
      provisioned_tenant_id: { type: DataTypes.UUID, allowNull: true },
      invitation_token_hash: { type: DataTypes.CHAR(64), allowNull: true },
      invitation_expires_at: { type: DataTypes.DATE, allowNull: true },
      invitation_sent_at: { type: DataTypes.DATE, allowNull: true },
      invitation_accepted_at: { type: DataTypes.DATE, allowNull: true },
      source_ip_hash: { type: DataTypes.CHAR(64), allowNull: false },
      user_agent: { type: DataTypes.STRING(256), allowNull: true },
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
    if (!(await constraintExists(context, transaction, CHECK))) {
      await context.sequelize.query(ADD_CHECK_SQL, { transaction });
    }
    if (!(await constraintExists(context, transaction, TENANT_FK))) {
      await context.sequelize.query(TENANT_FK_SQL, { transaction });
    }
    for (const sql of INDEX_SQL) {
      await context.sequelize.query(sql, { transaction });
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(`DROP TABLE IF EXISTS ${TABLE}`, { transaction });
    for (const type of ENUM_TYPES) {
      await context.sequelize.query(`DROP TYPE IF EXISTS "${type}"`, { transaction });
    }
  });
};

export = {
  TABLE,
  CHECK,
  INDEX_QUEUE,
  INDEX_EMAIL,
  INDEX_INVITATION,
  ENUM_TYPES,
  FK_COLUMNS,
  TENANT_FK,
  TENANT_FK_SQL,
  ADD_CHECK_SQL,
  INDEX_SQL,
  up,
  down,
};
