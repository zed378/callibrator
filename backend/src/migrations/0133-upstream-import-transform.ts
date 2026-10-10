/**
 * Migration 0133 — the upstream import's stage 2, the transform (P24-01; ADR-129 § 10 and its
 * Amendment 1; docs/UPSTREAM/05 § 3.5, § 4, § 8; threat model AM-28, G-29).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. The TRANSFORM ROLE (`UPSTREAM_TRANSFORM_DB_ROLE`, default `callibrator_transform`):
 *     created NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS when absent, the
 *     migrating role made able to SET ROLE to it (0057's rule). It is the only role that both
 *     reads the staging schema and writes the bookkeeping. It is given NOTHING in `public` here:
 *     each transform of P24-02 grants it exactly the target tables it writes, in its own
 *     migration.
 *  2. `upstream_import.id_map` — one row per upstream row the transform has decided, keyed by
 *     (source_table, legacy_id): the target row, its tenant, the facility the transform DECIDED
 *     (`client_facility_id`, AM-28 — what reconciliation RC-F1 compares with what landed), the
 *     run that last wrote it, the SHA-256 of the canonical source row (05 § 8: same hash → skip,
 *     another → update or void-and-supersede), and `source_values` (only the raw values the
 *     transform changed; NEVER for `users`, by CHECK). Target ids are generated, never derived
 *     from the legacy id (05 § 4).
 *  3. `upstream_import.quarantine` — every staged row the transform did not map, with a reason
 *     from a fixed vocabulary (CHECK, @callibrator/contracts UPSTREAM_IMPORT_QUARANTINE_REASONS):
 *     a row is mapped or quarantined, never dropped silently (05 § 1.2). One row per (run, source
 *     table, staged row, reason); a re-run of a run's transform replaces that run's rows.
 *     Codes only: no value of the row is stored, only its staged row number and legacy id.
 *     Both tables are created AS the import role, which owns the schema (0114).
 *  4. Grants inside `upstream_import`: the transform role gets USAGE on the schema, SELECT on
 *     every table in it (the staging tables), SELECT/INSERT/UPDATE on `id_map` (no DELETE: a
 *     mapping is history), SELECT/INSERT/DELETE on `quarantine`, and — through the import role's
 *     DEFAULT PRIVILEGES — SELECT on every staging table the import creates later. The
 *     application role gets nothing (0114 revoked the schema from it and from PUBLIC; revoked
 *     again here for the two new tables).
 *  5. The run's transform columns on `upstream_sql_imports` (the model declares them; db.sync()
 *     creates them on a fresh database): `transform_error_code`, `transform_requested_at`,
 *     `transform_requested_by` (users, SET NULL), `transform_started_at`,
 *     `transform_finished_at`, `transform_batch_job_id` (batch_jobs, SET NULL),
 *     `transform_summary` (JSONB, counts only). CHECKs: the widened vocabulary, a transform
 *     only on a LOADED run, an error code exactly when the transform failed. Indexes: one
 *     transform at a time (partial UNIQUE over requested / transforming), and a leading index on
 *     each new foreign key (D-20).
 *
 * Throws, rather than skipping, when the staging schema, the import role, the run table or the
 * application role is absent, or a role cannot be switched to (PR-5). No try/catch. Verify with
 * psql, not the log:
 *   \dt upstream_import.*                       -- id_map, quarantine (owner callibrator_import)
 *   \dp upstream_import.id_map                  -- callibrator_transform=arw, no callibrator_app
 *   SET ROLE callibrator_app; SELECT 1 FROM upstream_import.id_map;   -- permission denied
 *   \d upstream_sql_imports                     -- upstream_sql_imports_one_transforming
 *
 * `down` REFUSES while `id_map` or `quarantine` holds a row or a run's transform status is not
 * `not_available`; else it drops what `up` added. The role stays (cluster-wide, as 0057's).
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS, UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES } from "@callibrator/contracts/upstreamSqlImport";
import { env } from "../config/env";

const TABLE = "upstream_sql_imports";
const SCHEMA = "upstream_import";
const ID_MAP = `${SCHEMA}.id_map`;
const QUARANTINE = `${SCHEMA}.quarantine`;
const DEFAULT_APP_ROLE = "callibrator_app";
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const DEFAULT_TRANSFORM_ROLE = "callibrator_transform";
const ONE_TRANSFORMING = "upstream_sql_imports_one_transforming";
const VOCABULARY = "upstream_sql_imports_vocabulary";
const LOCK_TIMEOUT = "10s";
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

const list = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(", ");

/** 0114's vocabulary CHECK, widened to the transform statuses. */
const VOCABULARY_BEFORE =
  "data_class IN ('synthetic', 'real') AND compression IN ('none', 'gzip') AND transform_status IN ('not_available')";
const VOCABULARY_AFTER =
  "data_class IN ('synthetic', 'real') AND compression IN ('none', 'gzip') " +
  `AND transform_status IN (${list(UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES)})`;

/** The run table's new CHECKs. */
const RUN_CHECKS: Readonly<Record<string, string>> = Object.freeze({
  upstream_sql_imports_transform_after_load: "transform_status = 'not_available' OR status = 'loaded'",
  upstream_sql_imports_transform_error_when_failed: "(transform_status = 'transform_failed') = (transform_error_code IS NOT NULL)",
});

/** The run table's new columns (column, DDL). */
const RUN_COLUMNS: readonly (readonly [column: string, ddl: string])[] = Object.freeze([
  ["transform_error_code", "VARCHAR(64)"],
  ["transform_requested_at", "TIMESTAMP WITH TIME ZONE"],
  ["transform_requested_by", "UUID REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE"],
  ["transform_started_at", "TIMESTAMP WITH TIME ZONE"],
  ["transform_finished_at", "TIMESTAMP WITH TIME ZONE"],
  ["transform_batch_job_id", "UUID REFERENCES batch_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE"],
  ["transform_summary", "JSONB"],
]);

const RUN_INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS ${ONE_TRANSFORMING} ON ${TABLE} ((true)) WHERE transform_status IN ('transform_requested', 'transforming')`,
  `CREATE INDEX IF NOT EXISTS ${TABLE}_transform_requested_by ON ${TABLE} (transform_requested_by)`,
  `CREATE INDEX IF NOT EXISTS ${TABLE}_transform_batch_job_id ON ${TABLE} (transform_batch_job_id)`,
]);

const ID_MAP_SQL = `CREATE TABLE IF NOT EXISTS ${ID_MAP} (
  source_table text NOT NULL CONSTRAINT id_map_source_table_name CHECK (source_table ~ '^[a-z_][a-z0-9_]{0,62}$'),
  legacy_id text NOT NULL CONSTRAINT id_map_legacy_id_length CHECK (length(legacy_id) BETWEEN 1 AND 255),
  target_table text NOT NULL CONSTRAINT id_map_target_table_name CHECK (target_table ~ '^[a-z_][a-z0-9_]{0,62}$'),
  target_id uuid NOT NULL,
  tenant_id uuid,
  client_facility_id uuid,
  import_run_id uuid NOT NULL,
  source_row_hash char(64) NOT NULL CONSTRAINT id_map_source_row_hash_hex CHECK (source_row_hash ~ '^[0-9a-f]{64}$'),
  source_values jsonb CONSTRAINT id_map_source_values_object CHECK (source_values IS NULL OR jsonb_typeof(source_values) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, legacy_id),
  CONSTRAINT id_map_no_user_values CHECK (source_table <> 'users' OR source_values IS NULL),
  CONSTRAINT id_map_facility_needs_tenant CHECK (client_facility_id IS NULL OR tenant_id IS NOT NULL)
)`;

const QUARANTINE_SQL = `CREATE TABLE IF NOT EXISTS ${QUARANTINE} (
  import_run_id uuid NOT NULL,
  source_table text NOT NULL CONSTRAINT quarantine_source_table_name CHECK (source_table ~ '^[a-z_][a-z0-9_]{0,62}$'),
  source_row_number bigint NOT NULL CONSTRAINT quarantine_source_row_number_positive CHECK (source_row_number > 0),
  legacy_id text CONSTRAINT quarantine_legacy_id_length CHECK (legacy_id IS NULL OR length(legacy_id) BETWEEN 1 AND 255),
  reason text NOT NULL CONSTRAINT quarantine_reason_vocabulary CHECK (reason IN (${list(UPSTREAM_IMPORT_QUARANTINE_REASONS)})),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (import_run_id, source_table, source_row_number, reason)
)`;

const BOOKKEEPING_INDEX_SQL = Object.freeze([
  `CREATE INDEX IF NOT EXISTS id_map_target ON ${ID_MAP} (target_table, target_id)`,
  `CREATE INDEX IF NOT EXISTS id_map_import_run_id ON ${ID_MAP} (import_run_id)`,
  `CREATE INDEX IF NOT EXISTS quarantine_reason ON ${QUARANTINE} (import_run_id, reason)`,
]);

type Row = Record<string, unknown>;

const rows = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row): Promise<Row[]> => {
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
    throw new Error(`0133: ${variable} "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). Refusing to interpolate it.`);
  }
  return name;
};

/** The transform role exists, and the migrating role may SET ROLE to it (0057's rule, as 0114's import role). */
const ensureTransformRole = async (sequelize: Sequelize, transaction: Transaction, role: string): Promise<void> => {
  if (!(await truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role)", { role }))) {
    if (!(await truthy(sequelize, transaction, "SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user"))) {
      throw new Error(
        `0133: the transform role "${role}" does not exist and the migrating role cannot create it (no CREATEROLE). ` +
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
      `0133: the transform role "${role}" exists but the migrating role can neither SET ROLE to it nor grant itself ` +
        `membership. GRANT ${role} TO <this database's owner> as an administrator, or set UPSTREAM_TRANSFORM_DB_ROLE ` +
        "to a role name for this database alone.",
    );
  }
  await run(sequelize, transaction, `GRANT ${role} TO CURRENT_USER`);
};

const hasConstraint = (sequelize: Sequelize, transaction: Transaction, name: string): Promise<boolean> =>
  truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = :table::regclass AND conname = :name)", {
    table: TABLE,
    name,
  });

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const appRole = roleName("DB_APP_ROLE", DEFAULT_APP_ROLE);
  const importRole = roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  const transformRole = roleName("UPSTREAM_TRANSFORM_DB_ROLE", DEFAULT_TRANSFORM_ROLE);
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const [label, present] of [
      [`table ${TABLE}`, `to_regclass('${TABLE}') IS NOT NULL`],
      [`schema ${SCHEMA}`, `EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${SCHEMA}')`],
      [`the import role "${importRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${importRole}')`],
      [`the application role "${appRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}')`],
    ] as const) {
      if (!(await truthy(sequelize, transaction, present))) {
        throw new Error(`0133: ${label} does not exist. Migrations 0057 and 0114 create it; run the migrations in order.`);
      }
    }
    if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
      throw new Error(`0133: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
    }

    // 1. The transform role.
    await ensureTransformRole(sequelize, transaction, transformRole);

    // 2 – 4. The bookkeeping, created AS the import role (the schema's owner), and its grants.
    await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
    await run(sequelize, transaction, ID_MAP_SQL);
    await run(sequelize, transaction, QUARANTINE_SQL);
    for (const statement of BOOKKEEPING_INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }
    await run(sequelize, transaction, `REVOKE ALL ON ${ID_MAP}, ${QUARANTINE} FROM PUBLIC`);
    await run(sequelize, transaction, `REVOKE ALL ON ${ID_MAP}, ${QUARANTINE} FROM ${appRole}`);
    await run(sequelize, transaction, `GRANT USAGE ON SCHEMA ${SCHEMA} TO ${transformRole}`);
    await run(sequelize, transaction, `GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${transformRole}`);
    await run(sequelize, transaction, `GRANT INSERT, UPDATE ON ${ID_MAP} TO ${transformRole}`);
    await run(sequelize, transaction, `GRANT INSERT, DELETE ON ${QUARANTINE} TO ${transformRole}`);
    await run(sequelize, transaction, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT SELECT ON TABLES TO ${transformRole}`);
    await run(sequelize, transaction, "RESET ROLE");

    // 5. The run's transform columns, CHECKs and indexes.
    for (const [column, ddl] of RUN_COLUMNS) {
      await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`);
    }
    if (await hasConstraint(sequelize, transaction, VOCABULARY)) {
      await run(sequelize, transaction, `ALTER TABLE ${TABLE} DROP CONSTRAINT ${VOCABULARY}`);
    }
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${VOCABULARY} CHECK (${VOCABULARY_AFTER})`);
    for (const [name, predicate] of Object.entries(RUN_CHECKS)) {
      if (!(await hasConstraint(sequelize, transaction, name))) {
        await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }
    for (const statement of RUN_INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const importRole = roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  const transformRole = roleName("UPSTREAM_TRANSFORM_DB_ROLE", DEFAULT_TRANSFORM_ROLE);
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const table of [ID_MAP, QUARANTINE]) {
      if (
        (await truthy(sequelize, transaction, `to_regclass('${table}') IS NOT NULL`)) &&
        (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${table})`))
      ) {
        throw new Error(`0133 down: ${table} holds the import's decisions; refusing to drop them.`);
      }
    }
    if (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${TABLE} WHERE transform_status <> 'not_available')`)) {
      throw new Error(`0133 down: a run of ${TABLE} has a transform status; refusing to narrow the vocabulary under it.`);
    }
    for (const statement of [
      `DROP INDEX IF EXISTS ${ONE_TRANSFORMING}`,
      `DROP INDEX IF EXISTS ${TABLE}_transform_requested_by`,
      `DROP INDEX IF EXISTS ${TABLE}_transform_batch_job_id`,
      ...Object.keys(RUN_CHECKS).map((name) => `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${name}`),
      `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${VOCABULARY}`,
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${VOCABULARY} CHECK (${VOCABULARY_BEFORE})`,
      ...RUN_COLUMNS.map(([column]) => `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${column}`),
    ]) {
      await run(sequelize, transaction, statement);
    }
    if (await truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role)", { role: transformRole })) {
      await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
      await run(sequelize, transaction, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} REVOKE SELECT ON TABLES FROM ${transformRole}`);
      await run(sequelize, transaction, `REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM ${transformRole}`);
      await run(sequelize, transaction, `REVOKE ALL ON SCHEMA ${SCHEMA} FROM ${transformRole}`);
      await run(sequelize, transaction, "RESET ROLE");
    }
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${QUARANTINE}`);
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${ID_MAP}`);
  });
};

export = {
  TABLE,
  SCHEMA,
  ID_MAP,
  QUARANTINE,
  ONE_TRANSFORMING,
  VOCABULARY_AFTER,
  RUN_CHECKS,
  RUN_COLUMNS,
  RUN_INDEX_SQL,
  BOOKKEEPING_INDEX_SQL,
  DEFAULT_TRANSFORM_ROLE,
  roleName,
  up,
  down,
};
