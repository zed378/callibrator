"use strict";

/**
 * `calibration_records` is append-only as a DATABASE constraint, not a
 * service-layer convention (P6-03, PR-2, BR-7; ADR-PENDING-data).
 *
 * WHAT WAS WRONG
 *
 * The model was `paranoid`, the API exposed `PUT` and `DELETE`, and a
 * calibration result could be edited in place after the fact. Nothing in the
 * database refused it. On top of that the backend connects as the database
 * OWNER (the compose image's POSTGRES_USER, a superuser), so a
 * `REVOKE UPDATE, DELETE` alone would have been decorative: an owner can
 * re-grant, and a superuser bypasses privilege checks entirely (A-240).
 *
 * WHAT THIS DOES — one transaction
 *
 *  1. The correction/void lifecycle columns (the model declares the same, so a
 *     fresh `db.sync()` has them; an existing table gains them here):
 *       supersedes_id     — on a CORRECTION row: the record it corrects
 *       correction_reason — on a CORRECTION row: why (required with it)
 *       superseded_by_id  — on the CORRECTED row: set once, never changed
 *       superseded_at     — set once with it
 *       void_reason       — set once when a record is voided
 *       voided_by         — set once with it
 *  2. Rows soft-deleted before this migration get a void reason saying so —
 *     BEFORE the trigger and the CHECK exist, so the backfill is allowed and
 *     the CHECK holds for every row.
 *  3. CHECK constraints: a voided row names a reason; a correction names a
 *     reason and never supersedes itself. A PARTIAL UNIQUE index on
 *     supersedes_id: a record is corrected at most once, so the chain is linear.
 *  4. The TRIGGER `calibration_records_append_only`, which holds for EVERY role
 *     including the owner and a superuser (only DDL or
 *     `session_replication_role = replica` — both superuser/owner acts that
 *     are themselves visible — get past it):
 *       - DELETE and TRUNCATE are refused;
 *       - UPDATE may change ONLY the lifecycle columns above plus
 *         is_deleted, deleted_at and updated_at, and each of them only ONE
 *         WAY: NULL -> value (never changed again), is_deleted false -> true
 *         (never restored). Every other column — including any column added
 *         later — is immutable, because the comparison is "everything except
 *         the listed lifecycle columns".
 *  5. The APPLICATION ROLE (`DB_APP_ROLE`, default `callibrator_app`), a
 *     NOLOGIN role the backend drops to after migrating (utils/dbRole.util.js):
 *     DML on every table and sequence in the schema (and, through default
 *     privileges, on tables the owner creates later), MINUS UPDATE, DELETE and
 *     TRUNCATE on calibration_records, with UPDATE granted back on the
 *     lifecycle columns alone. The migrating role is made a member so it can
 *     `SET ROLE` to it.
 *
 *  0. PREREQUISITE — row level security left behind (A-242). Migration 0012
 *     ran ENABLE + FORCE ROW LEVEL SECURITY on every table, then a CREATE
 *     POLICY naming tenant_id — which failed, inside a swallowed catch, on the
 *     five tables with no tenant_id (categories, posts, post_categories,
 *     workflow_steps, workflow_actions). 0015 undid RLS only where the policy
 *     existed. RLS on with no policy denies every row to every role that is
 *     not a superuser — FORCE includes the owner. Invisible in compose, where
 *     the backend is a superuser; fatal for the application role (and for a
 *     non-superuser owner on managed PostgreSQL). ADR-029 removed RLS, so RLS
 *     is switched off on every table that has it and carries no policy.
 *
 * The trigger is the guarantee in every deployment; the grant is the second,
 * independent layer, and the one an auditor asks for by name. Either alone
 * refuses a DELETE; `make migrate-verify` (P6-05) checks both exist.
 *
 * Throws, rather than skipping, when the table is absent: the backend runs
 * db.sync() before the migrator, and a skip would be recorded as applied with
 * no trigger — then sync would create the table unprotected (PR-5).
 *
 * No try/catch: every failure propagates (CLAUDE.md; 0008/0013/0014).
 * Verify with psql, not the log:
 *   SELECT tgname FROM pg_trigger WHERE tgrelid = 'calibration_records'::regclass AND NOT tgisinternal;
 *   SET ROLE callibrator_app; DELETE FROM calibration_records WHERE false;  -- permission denied
 */

const TABLE = "calibration_records";
const FUNCTION_NAME = "calibration_records_append_only";
const ROW_TRIGGER = "calibration_records_append_only";
const TRUNCATE_TRIGGER = "calibration_records_no_truncate";
const SUPERSEDES_INDEX = "calibration_records_supersedes_id_unique";
const CHECK_VOID = "calibration_records_void_reason_check";
const CHECK_CORRECTION = "calibration_records_correction_check";
const DEFAULT_APP_ROLE = "callibrator_app";
const LOCK_TIMEOUT = "10s";

/** What a row soft-deleted before P6-03 says about why. */
const LEGACY_VOID_REASON = "Deleted before P6-03 (2026-09-24); no reason was recorded.";

/**
 * The columns an UPDATE may touch — each only one way (see the trigger).
 * Exported: the application role's column-level UPDATE grant is this list,
 * and the model/service must never need more.
 */
const LIFECYCLE_COLUMNS = Object.freeze([
  "superseded_by_id",
  "superseded_at",
  "void_reason",
  "voided_by",
  "is_deleted",
  "deleted_at",
  "updated_at",
]);

/** Columns this migration adds, with their DDL. */
const NEW_COLUMNS = Object.freeze([
  ["supersedes_id", `UUID REFERENCES ${TABLE} (id) ON DELETE RESTRICT ON UPDATE CASCADE`],
  ["correction_reason", "TEXT"],
  ["superseded_by_id", `UUID REFERENCES ${TABLE} (id) ON DELETE RESTRICT ON UPDATE CASCADE`],
  ["superseded_at", "TIMESTAMP WITH TIME ZONE"],
  ["void_reason", "TEXT"],
  ["voided_by", "UUID REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE"],
]);

/**
 * @param {string|undefined} raw - DB_APP_ROLE
 * @returns {string} a safe, unquoted role identifier
 */
const appRoleName = (raw = process.env.DB_APP_ROLE) => {
  const name = raw === undefined || raw === "" || raw === "none" ? DEFAULT_APP_ROLE : raw;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `0057: DB_APP_ROLE "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). ` +
        "Refusing to interpolate it into GRANT statements.",
    );
  }
  return name;
};

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  lifecycle CONSTANT text[] := ARRAY[${LIFECYCLE_COLUMNS.map((c) => `'${c}'`).join(", ")}];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'calibration_records is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'calibration_records is append-only: record % cannot be deleted', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Void it (POST /calibration-records/:id/void) or correct it with a superseding record.';
  END IF;
  IF (to_jsonb(NEW) - lifecycle) IS DISTINCT FROM (to_jsonb(OLD) - lifecycle) THEN
    RAISE EXCEPTION 'calibration_records is append-only: the content of record % cannot be changed', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Write a correction (POST /calibration-records/:id/corrections); the original stays.';
  END IF;
  IF (OLD.superseded_by_id IS NOT NULL AND NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
     OR (OLD.void_reason IS NOT NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason)
     OR (OLD.voided_by IS NOT NULL AND NEW.voided_by IS DISTINCT FROM OLD.voided_by)
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     OR (OLD.is_deleted AND NOT NEW.is_deleted) THEN
    RAISE EXCEPTION 'calibration_records is append-only: a supersession or void of record % is final', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$`;

/** @returns {Promise<boolean>} */
const tableExists = async (sequelize, transaction) => {
  const [[{ present }]] = await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { transaction, replacements: { table: TABLE } },
  );
  return present;
};

/** @returns {Promise<Set<string>>} the table's column names */
const columnNames = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table`,
    { transaction, replacements: { table: TABLE } },
  );
  return new Set(rows.map((r) => r.column_name));
};

/** @returns {Promise<Set<string>>} the table's constraint names */
const constraintNames = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    "SELECT conname FROM pg_constraint WHERE conrelid = (current_schema() || '.' || :table)::regclass",
    { transaction, replacements: { table: TABLE } },
  );
  return new Set(rows.map((r) => r.conname));
};

/**
 * Create the application role when absent (it is cluster-wide: another
 * database on the same cluster may already have made it) and grant it DML.
 */
const grantApplicationRole = async (sequelize, transaction, role) => {
  const [[{ exists }]] = await sequelize.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role) AS exists",
    { transaction, replacements: { role } },
  );
  if (!exists) {
    const [[{ can }]] = await sequelize.query(
      "SELECT (rolsuper OR rolcreaterole) AS can FROM pg_roles WHERE rolname = current_user",
      { transaction },
    );
    if (!can) {
      throw new Error(
        `0057: the application role "${role}" does not exist and the migrating role cannot create it ` +
          `(no CREATEROLE). Create it once as an administrator — CREATE ROLE ${role} NOLOGIN; ` +
          `GRANT ${role} TO <this database's owner>; — then restart the backend.`,
      );
    }
    await sequelize.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, {
      transaction,
    });
  }
  // The migrating role must be able to SET ROLE to it (PG16+: a CREATEROLE
  // creator gets ADMIN on the role, not SET). A superuser can always.
  const [[membership]] = await sequelize.query(
    `SELECT pg_has_role(current_user, :role, 'SET') AS can_set,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
              OR EXISTS (SELECT 1 FROM pg_auth_members m
                          WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = :role)
                            AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                            AND m.admin_option) AS can_grant`,
    { transaction, replacements: { role } },
  );
  if (!membership.can_set) {
    if (!membership.can_grant) {
      throw new Error(
        `0057: the application role "${role}" exists but the migrating role can neither SET ROLE to it ` +
          "nor grant itself membership. Roles are cluster-wide: another database on this cluster may " +
          `have created it. Either GRANT ${role} TO <this database's owner> as an administrator, or set ` +
          "DB_APP_ROLE to a role name for this database alone.",
      );
    }
    await sequelize.query(`GRANT ${role} TO CURRENT_USER`, { transaction });
  }

  await sequelize.query(`GRANT USAGE ON SCHEMA public TO ${role}`, { transaction });
  await sequelize.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    { transaction },
  );
  await sequelize.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`, {
    transaction,
  });
  // Tables and sequences the owner creates LATER (db.sync(), later migrations).
  await sequelize.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    { transaction },
  );
  await sequelize.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`,
    { transaction },
  );

  // The point of it all.
  await sequelize.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${TABLE} FROM ${role}`, { transaction });
  await sequelize.query(`GRANT UPDATE (${LIFECYCLE_COLUMNS.join(", ")}) ON ${TABLE} TO ${role}`, {
    transaction,
  });
};

module.exports = {
  TABLE,
  FUNCTION_NAME,
  ROW_TRIGGER,
  TRUNCATE_TRIGGER,
  SUPERSEDES_INDEX,
  LIFECYCLE_COLUMNS,
  LEGACY_VOID_REASON,
  DEFAULT_APP_ROLE,
  appRoleName,

  up: async ({ context }) => {
    const { sequelize } = context;
    const role = appRoleName();
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      if (!(await tableExists(sequelize, transaction))) {
        throw new Error(
          `0057: table ${TABLE} does not exist. Run db.sync() first (the backend does at boot); ` +
            "skipping would record this migration as applied with no append-only trigger.",
        );
      }

      // 0. RLS left on with no policy (A-242) — before the role can use the tables.
      const [orphans] = await sequelize.query(
        `SELECT c.relname AS table_name
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity
            AND NOT EXISTS (SELECT 1 FROM pg_policies p
                             WHERE p.schemaname = n.nspname AND p.tablename = c.relname)`,
        { transaction },
      );
      for (const { table_name: table } of orphans) {
        await sequelize.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`, { transaction });
        await sequelize.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`, { transaction });
      }

      // 1. Columns.
      const columns = await columnNames(sequelize, transaction);
      for (const [name, ddl] of NEW_COLUMNS) {
        if (!columns.has(name)) {
          await sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN ${name} ${ddl}`, { transaction });
        }
      }

      // 2. Backfill — before the trigger exists.
      await sequelize.query(`DROP TRIGGER IF EXISTS ${ROW_TRIGGER} ON ${TABLE}`, { transaction });
      await sequelize.query(
        `UPDATE ${TABLE} SET void_reason = :reason WHERE is_deleted AND void_reason IS NULL`,
        { transaction, replacements: { reason: LEGACY_VOID_REASON } },
      );

      // 3. Constraints and the linear-chain index.
      const constraints = await constraintNames(sequelize, transaction);
      if (!constraints.has(CHECK_VOID)) {
        await sequelize.query(
          `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK_VOID} ` +
            "CHECK (NOT is_deleted OR (void_reason IS NOT NULL AND btrim(void_reason) <> ''))",
          { transaction },
        );
      }
      if (!constraints.has(CHECK_CORRECTION)) {
        await sequelize.query(
          `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CHECK_CORRECTION} CHECK (supersedes_id IS NULL OR ` +
            "(supersedes_id <> id AND correction_reason IS NOT NULL AND btrim(correction_reason) <> ''))",
          { transaction },
        );
      }
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${SUPERSEDES_INDEX} ON ${TABLE} (supersedes_id) ` +
          "WHERE supersedes_id IS NOT NULL",
        { transaction },
      );

      // 4. The trigger — the guarantee for every role.
      await sequelize.query(FUNCTION_SQL, { transaction });
      await sequelize.query(
        `CREATE TRIGGER ${ROW_TRIGGER} BEFORE UPDATE OR DELETE ON ${TABLE} ` +
          `FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()`,
        { transaction },
      );
      await sequelize.query(`DROP TRIGGER IF EXISTS ${TRUNCATE_TRIGGER} ON ${TABLE}`, { transaction });
      await sequelize.query(
        `CREATE TRIGGER ${TRUNCATE_TRIGGER} BEFORE TRUNCATE ON ${TABLE} ` +
          `FOR EACH STATEMENT EXECUTE FUNCTION ${FUNCTION_NAME}()`,
        { transaction },
      );

      // 5. The application role.
      await grantApplicationRole(sequelize, transaction, role);
    });
  },

  /**
   * Removes the trigger, the function and the calibration_records-specific
   * grant shape (the role keeps plain DML there, as every other table). The
   * lifecycle columns, CHECKs and index stay: dropping them would erase which
   * record corrects which — a rollback must not destroy the record trail.
   * The role itself is NOT dropped: it is cluster-wide.
   */
  down: async ({ context }) => {
    const { sequelize } = context;
    const role = appRoleName();
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(`DROP TRIGGER IF EXISTS ${ROW_TRIGGER} ON ${TABLE}`, { transaction });
      await sequelize.query(`DROP TRIGGER IF EXISTS ${TRUNCATE_TRIGGER} ON ${TABLE}`, { transaction });
      await sequelize.query(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`, { transaction });
      const [[{ exists }]] = await sequelize.query(
        "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role) AS exists",
        { transaction, replacements: { role } },
      );
      if (exists) {
        await sequelize.query(`GRANT UPDATE, DELETE ON ${TABLE} TO ${role}`, { transaction });
      }
    });
  },
};
