/**
 * Migration 0114 — the SQL-dump import (P24-06; ADR-129): its run table, its staging schema, and the role that
 * alone may write that schema.
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. `upstream_sql_imports` and its ENUM `enum_upstream_sql_imports_status`
 *     unless the table exists — db.sync() runs BEFORE the migrations at boot
 *     and creates it from the model on a database that has never seen it.
 *     A PLATFORM table: no tenant column (`notify_tenant_id` is a routing hint).
 *  2. CHECKs (sync never creates one): a lower-case hex SHA-256; the declared
 *     data class, compression and transform status from their vocabularies;
 *     non-negative counts, attempt ≥ 1; an error code exactly when the run
 *     FAILED; a file path only while the file is not deleted, and none once
 *     the run is loaded or cancelled (the file is personal data: UU PDP
 *     minimisation — it goes as soon as it has served).
 *  3. Indexes, none on the model (ADR-100 Am. 3): the list order; ONE active
 *     run at a time (a partial UNIQUE index over the non-terminal states —
 *     the staging DDL is serialised by the database, not only the service);
 *     a leading index on each foreign key (D-20).
 *  4. The APPLICATION ROLE (`DB_APP_ROLE`, default `callibrator_app`, 0057)
 *     loses DELETE and TRUNCATE on `upstream_sql_imports`: a run is a record.
 *  5. The IMPORT ROLE (`UPSTREAM_IMPORT_DB_ROLE`, default
 *     `callibrator_import`): created NOLOGIN, NOSUPERUSER, NOCREATEDB,
 *     NOCREATEROLE, NOBYPASSRLS when absent (roles are cluster-wide); the
 *     migrating role made able to SET ROLE to it (the 0057 rule). It is given
 *     NOTHING in `public`.
 *  6. The STAGING SCHEMA `upstream_import`, OWNED by the import role (so it
 *     creates and writes its tables, and nobody else needs a grant), with
 *     every privilege on it REVOKED from PUBLIC and from the application role:
 *     `callibrator_app` can neither read nor write staged upstream data
 *     (docs/UPSTREAM/05 § 4, 06-DPIA; proven as that role in
 *     tests/services/upstreamSqlImport.p2406.live).
 *
 * Throws, rather than skipping, when a table it builds on (users, tenants,
 * batch_jobs) or the application role is absent, or when the import role
 * exists and the migrating role can neither SET ROLE to it nor grant itself
 * membership: a skip would be recorded as applied with no control (PR-5). No
 * try/catch: a failure propagates and the migration is not recorded. Verify
 * with psql, not the log:
 *   \d upstream_sql_imports                     -- 5 CHECKs, upstream_sql_imports_one_active
 *   \dn+ upstream_import                        -- owner callibrator_import, no other ACL entry
 *   SET ROLE callibrator_app; SELECT 1 FROM upstream_import.stg_users;   -- permission denied
 *
 * `down` REFUSES while a run exists or any staging table holds a row; else it
 * drops the schema, the table and its type. The role stays (cluster-wide, as 0057's).
 */
import { DataTypes, type QueryInterface, type Sequelize, type Transaction } from "sequelize";
import { UPSTREAM_SQL_IMPORT_STATUSES } from "@callibrator/contracts/states";
import { env } from "../config/env";

const TABLE = "upstream_sql_imports";
const ENUM_TYPE = "enum_upstream_sql_imports_status";
const SCHEMA = "upstream_import";
const DEFAULT_APP_ROLE = "callibrator_app";
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const ONE_ACTIVE = "upstream_sql_imports_one_active";
const LOCK_TIMEOUT = "10s";
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** The D-20 foreign-key columns, each with a leading index. */
const FK_COLUMNS = Object.freeze(["uploaded_by", "cancelled_by", "batch_job_id"]);

const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  upstream_sql_imports_sha256_hex: "sha256 ~ '^[0-9a-f]{64}$'",
  upstream_sql_imports_vocabulary:
    "data_class IN ('synthetic', 'real') AND compression IN ('none', 'gzip') AND transform_status IN ('not_available')",
  upstream_sql_imports_counts:
    "size_bytes >= 0 AND bytes_read >= 0 AND uncompressed_bytes >= 0 AND rows_loaded >= 0 " +
    "AND rows_rejected >= 0 AND rows_not_extracted >= 0 AND attempt >= 1",
  upstream_sql_imports_error_when_failed: "(status = 'failed') = (error_code IS NOT NULL)",
  upstream_sql_imports_file_minimised:
    "(file_path IS NULL OR file_deleted_at IS NULL) AND (status NOT IN ('loaded', 'cancelled') OR file_path IS NULL)",
});

const INDEX_SQL = Object.freeze([
  `CREATE INDEX IF NOT EXISTS ${TABLE}_created_at ON ${TABLE} (created_at DESC, id DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${ONE_ACTIVE} ON ${TABLE} ((true)) WHERE status IN ('uploaded', 'scanning', 'parsing')`,
  ...FK_COLUMNS.map((column) => `CREATE INDEX IF NOT EXISTS ${TABLE}_${column} ON ${TABLE} (${column})`),
]);

type Row = Record<string, unknown>;

const rows = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<Row[]> => {
  const [result] = (await sequelize.query(statement, { transaction, replacements })) as [Row[], unknown];
  return result;
};

const run = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<void> => {
  await sequelize.query(statement, { transaction, replacements });
};

const truthy = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<boolean> =>
  (await rows(sequelize, transaction, `SELECT (${statement}) AS yes`, replacements))[0]?.["yes"] === true;

/**
 * A role name from the environment, or its default.
 * @throws {Error} when it is not a plain lower-case identifier (it is interpolated into GRANT and DDL)
 */
const roleName = (variable: string, fallback: string, raw: string | undefined = env(variable)): string => {
  const name = raw === undefined || raw === "" || raw === "none" ? fallback : raw;
  if (!ROLE_PATTERN.test(name)) {
    throw new Error(`0114: ${variable} "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). Refusing to interpolate it.`);
  }
  return name;
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
      status: { type: DataTypes.ENUM(...UPSTREAM_SQL_IMPORT_STATUSES), allowNull: false, defaultValue: "uploaded" },
      data_class: { type: DataTypes.STRING(16), allowNull: false },
      compression: { type: DataTypes.STRING(8), allowNull: false },
      size_bytes: { type: DataTypes.BIGINT, allowNull: false },
      sha256: { type: DataTypes.STRING(64), allowNull: false },
      file_path: { type: DataTypes.TEXT, allowNull: true },
      file_deleted_at: { type: DataTypes.DATE, allowNull: true },
      file_retain_until: { type: DataTypes.DATE, allowNull: true },
      bytes_read: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      uncompressed_bytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      rows_loaded: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      rows_rejected: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      rows_not_extracted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      tables: { type: DataTypes.JSONB, allowNull: true },
      parse_summary: { type: DataTypes.JSONB, allowNull: true },
      error_code: { type: DataTypes.STRING(64), allowNull: true },
      transform_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "not_available" },
      attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      batch_job_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "batch_jobs", key: "id" },
        onDelete: "SET NULL",
      },
      uploaded_by: userFk(),
      notify_tenant_id: { type: DataTypes.UUID, allowNull: false },
      cancel_requested_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_by: userFk(),
      started_at: { type: DataTypes.DATE, allowNull: true },
      scanned_at: { type: DataTypes.DATE, allowNull: true },
      parse_started_at: { type: DataTypes.DATE, allowNull: true },
      finished_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    { transaction },
  );

/** Step 5: the import role exists, and the migrating role may SET ROLE to it (0057's rule). */
const ensureImportRole = async (sequelize: Sequelize, transaction: Transaction, role: string): Promise<void> => {
  if (!(await truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role)", { role }))) {
    if (!(await truthy(sequelize, transaction, "SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user"))) {
      throw new Error(
        `0114: the import role "${role}" does not exist and the migrating role cannot create it (no CREATEROLE). ` +
          `Create it once as an administrator — CREATE ROLE ${role} NOLOGIN; GRANT ${role} TO <this database's owner>; — then restart.`,
      );
    }
    await run(sequelize, transaction, `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  }
  if (await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role })) {
    return;
  }
  const canGrant = await truthy(
    sequelize,
    transaction,
    `(SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
       OR EXISTS (SELECT 1 FROM pg_auth_members m
                   WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = :role)
                     AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     AND m.admin_option)`,
    { role },
  );
  if (!canGrant) {
    throw new Error(
      `0114: the import role "${role}" exists but the migrating role can neither SET ROLE to it nor grant itself ` +
        `membership. GRANT ${role} TO <this database's owner> as an administrator, or set UPSTREAM_IMPORT_DB_ROLE ` +
        "to a role name for this database alone.",
    );
  }
  await run(sequelize, transaction, `GRANT ${role} TO CURRENT_USER`);
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const appRole = roleName("DB_APP_ROLE", DEFAULT_APP_ROLE);
  const importRole = roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const required of ["users", "tenants", "batch_jobs"]) {
      if (!(await truthy(sequelize, transaction, "to_regclass(current_schema() || '.' || :required) IS NOT NULL", { required }))) {
        throw new Error(
          `0114: table ${required} does not exist. Run db.sync() and the migrations before 0114 first ` +
            "(the backend does at boot); skipping would record this migration as applied with nothing built.",
        );
      }
    }
    if (!(await truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :appRole)", { appRole }))) {
      throw new Error(`0114: the application role "${appRole}" does not exist. Migration 0057 creates it; run the migrations in order.`);
    }

    // 1. The table.
    if (!(await truthy(sequelize, transaction, `to_regclass('${TABLE}') IS NOT NULL`))) {
      await createTable(context, transaction);
    }

    // 2. CHECKs.
    for (const [name, predicate] of Object.entries(CHECKS)) {
      const present = await truthy(
        sequelize,
        transaction,
        "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = :table::regclass AND conname = :name)",
        { table: TABLE, name },
      );
      if (!present) {
        await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }

    // 3. Indexes.
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 4. The application role keeps no DELETE or TRUNCATE on the runs.
    await run(sequelize, transaction, `REVOKE DELETE, TRUNCATE ON ${TABLE} FROM ${appRole}`);

    // 5. The import role.
    await ensureImportRole(sequelize, transaction, importRole);

    // 6. The staging schema, owned by the import role, closed to everyone else.
    await run(sequelize, transaction, `CREATE SCHEMA IF NOT EXISTS ${SCHEMA} AUTHORIZATION ${importRole}`);
    await run(sequelize, transaction, `ALTER SCHEMA ${SCHEMA} OWNER TO ${importRole}`);
    await run(sequelize, transaction, `REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC`);
    await run(sequelize, transaction, `REVOKE ALL ON SCHEMA ${SCHEMA} FROM ${appRole}`);
    await run(sequelize, transaction, `REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM PUBLIC`);
    await run(sequelize, transaction, `REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${appRole}`);
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    if (
      (await truthy(sequelize, transaction, `to_regclass('${TABLE}') IS NOT NULL`)) &&
      (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${TABLE})`))
    ) {
      throw new Error(`0114 down: ${TABLE} holds import runs; refusing to drop the import's record.`);
    }
    const staged = await rows(
      sequelize,
      transaction,
      "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :schema AND c.relkind = 'r'",
      { schema: SCHEMA },
    );
    for (const { name } of staged) {
      if (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${SCHEMA}."${String(name)}")`)) {
        throw new Error(`0114 down: ${SCHEMA}.${String(name)} holds staged rows; refusing to drop them.`);
      }
    }
    await run(sequelize, transaction, `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${TABLE}`);
    await run(sequelize, transaction, `DROP TYPE IF EXISTS ${ENUM_TYPE}`);
  });
};

export = { TABLE, ENUM_TYPE, SCHEMA, ONE_ACTIVE, CHECKS, INDEX_SQL, FK_COLUMNS, DEFAULT_IMPORT_ROLE, roleName, up, down };
