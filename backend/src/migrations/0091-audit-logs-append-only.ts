/**
 * `audit_logs` is append-only as a DATABASE constraint (Q-34, ADR-095;
 * ADR-051 Q-12: audit rows are never purged).
 *
 * WHAT WAS WRONG
 *
 * The service layer never deletes or rewrites an audit row, but nothing in the
 * database refused it. A live probe on 2026-09-29 showed the application role
 * `callibrator_app` holding UPDATE and DELETE on audit_logs (0057's blanket
 * DML grant) and no trigger on the table: one injected statement, or one
 * careless maintenance query, could erase or rewrite the trail that 21 CFR
 * Part 11 and ISO 17025 rest on. calibration_records had this protection
 * since 0057; the trail that records who changed those records did not.
 *
 * THE ONE LEGITIMATE UPDATE — GDPR masking (A-135)
 *
 * `dataRetention.service#maskAuditTrail` replaces a data subject's personal
 * data in their audit rows with "[REDACTED]": ip_address, user_agent, and
 * values inside `changes` under personal or network keys. ADR-051 Q-12 chose
 * masking over deletion, so it must keep working. ADR-095 records the debate
 * (forbid it / a SECURITY DEFINER masking function / this); the decision is
 * that the TRIGGER itself admits exactly the masking shape, for every role:
 *
 *   - ip_address and user_agent may change only TO the mask (never from it);
 *   - `changes` may change only by replacing the value under an object key
 *     with the mask — same structure, same keys, same array lengths, and
 *     nothing but mask values where it differs. The root is never replaced;
 *   - every other column is immutable ("everything except those three", so a
 *     column added later is immutable too).
 *
 * So an UPDATE can erase personal data and can never forge, reorder or
 * restore anything. No bypass flag exists to be abused: a SECURITY DEFINER
 * function would still need a way to tell the trigger "this caller is
 * allowed", and anything the definer can set, the owner can set too.
 *
 * WHAT THIS DOES — one transaction
 *
 *  1. `audit_logs_masks_only(old, new)`: true when `new` is `old` with some
 *     object-key values replaced by the mask. IMMUTABLE, recursive.
 *  2. The TRIGGER `audit_logs_append_only` (BEFORE UPDATE OR DELETE, each
 *     row) and `audit_logs_no_truncate` (BEFORE TRUNCATE): DELETE and
 *     TRUNCATE are refused; UPDATE is refused unless it is masking (above).
 *     Both are ENABLE ALWAYS: unlike 0057's, they fire even under
 *     `session_replication_role = replica`, so the only ways past them are
 *     DDL on the table (ALTER TABLE … DISABLE TRIGGER, DROP TRIGGER) — owner
 *     acts that are visible in the catalog and in the DDL log.
 *  3. The APPLICATION ROLE: REVOKE UPDATE, DELETE, TRUNCATE on audit_logs;
 *     GRANT UPDATE back on (ip_address, user_agent, changes) only — the
 *     second, independent layer. INSERT and SELECT stay.
 *
 * Throws, rather than skipping, when the table or the role is absent: boot
 * runs db.sync() then 0057 (which creates the role) before this, and a skip
 * would be recorded as applied with no trigger (PR-5).
 *
 * No try/catch: every failure propagates. Verify with psql, not the log:
 *   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal;
 *     -- audit_logs_append_only A, audit_logs_no_truncate A
 *   SET ROLE callibrator_app; DELETE FROM audit_logs WHERE false;  -- permission denied
 *
 * A LATER migration that must rewrite audit rows (none should) disables the
 * trigger for its own transaction, names why, and re-enables it.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { env } from "../config/env";

const TABLE = "audit_logs";
const FUNCTION_NAME = "audit_logs_append_only";
const MASK_FUNCTION = "audit_logs_masks_only";
const ROW_TRIGGER = "audit_logs_append_only";
const TRUNCATE_TRIGGER = "audit_logs_no_truncate";
const DEFAULT_APP_ROLE = "callibrator_app";
const LOCK_TIMEOUT = "10s";

/** The one value masking writes (dataRetention.service PII_MASK). */
const PII_MASK = "[REDACTED]";

/** The columns an UPDATE may touch — each only towards the mask. */
const MASKABLE_COLUMNS: readonly string[] = Object.freeze(["ip_address", "user_agent", "changes"]);

/**
 * @param raw - DB_APP_ROLE
 * @returns a safe, unquoted role identifier (0057's rule)
 */
const appRoleName = (raw: string | undefined = env("DB_APP_ROLE")): string => {
  const name = raw === undefined || raw === "" || raw === "none" ? DEFAULT_APP_ROLE : raw;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `0091: DB_APP_ROLE "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). ` +
        "Refusing to interpolate it into GRANT statements.",
    );
  }
  return name;
};

const MASK_LITERAL = `to_jsonb('${PII_MASK}'::text)`;

const MASK_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION ${MASK_FUNCTION}(old_value jsonb, new_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  k text;
  i integer;
BEGIN
  IF old_value IS NOT DISTINCT FROM new_value THEN
    RETURN true;
  END IF;
  IF old_value IS NULL OR new_value IS NULL THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(old_value) = 'object' AND jsonb_typeof(new_value) = 'object' THEN
    IF ARRAY(SELECT jsonb_object_keys(old_value) ORDER BY 1)
       IS DISTINCT FROM ARRAY(SELECT jsonb_object_keys(new_value) ORDER BY 1) THEN
      RETURN false;
    END IF;
    FOR k IN SELECT jsonb_object_keys(old_value) LOOP
      IF (new_value -> k) IS DISTINCT FROM (old_value -> k)
         AND (new_value -> k) IS DISTINCT FROM ${MASK_LITERAL}
         AND NOT ${MASK_FUNCTION}(old_value -> k, new_value -> k) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF jsonb_typeof(old_value) = 'array' AND jsonb_typeof(new_value) = 'array' THEN
    IF jsonb_array_length(old_value) <> jsonb_array_length(new_value) THEN
      RETURN false;
    END IF;
    FOR i IN 0 .. jsonb_array_length(old_value) - 1 LOOP
      IF NOT ${MASK_FUNCTION}(old_value -> i, new_value -> i) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  RETURN false;
END
$fn$`;

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  maskable CONSTANT text[] := ARRAY[${MASKABLE_COLUMNS.map((c) => `'${c}'`).join(", ")}];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: audit row % cannot be deleted', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Audit rows are never purged (ADR-051 Q-12). Mask personal data with mask-pii instead.';
  END IF;
  IF (to_jsonb(NEW) - maskable) IS DISTINCT FROM (to_jsonb(OLD) - maskable)
     OR (NEW.ip_address IS DISTINCT FROM OLD.ip_address AND NEW.ip_address IS DISTINCT FROM '${PII_MASK}')
     OR (NEW.user_agent IS DISTINCT FROM OLD.user_agent AND NEW.user_agent IS DISTINCT FROM '${PII_MASK}')
     OR NOT ${MASK_FUNCTION}(OLD.changes, NEW.changes) THEN
    RAISE EXCEPTION 'audit_logs is append-only: audit row % can only have personal data masked', OLD.id
      USING ERRCODE = '42501',
            HINT = 'The only permitted UPDATE replaces ip_address, user_agent or values inside changes with ${PII_MASK} (ADR-095).';
  END IF;
  RETURN NEW;
END
$fn$`;

type Query = Sequelize["query"];

/** Run one statement in `transaction`. */
const run = (sequelize: Sequelize, transaction: Transaction, statement: string): ReturnType<Query> =>
  sequelize.query(statement, { transaction });

/** @returns whether `name` names a row in pg_roles */
const roleExists = async (sequelize: Sequelize, transaction: Transaction, role: string): Promise<boolean> => {
  const [rows] = (await sequelize.query("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role) AS exists", {
    transaction,
    replacements: { role },
  })) as [{ exists: boolean }[], unknown];
  return rows[0]?.exists === true;
};

/** @returns whether the audit_logs table exists in the current schema */
const tableExists = async (sequelize: Sequelize, transaction: Transaction): Promise<boolean> => {
  const [rows] = (await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { transaction, replacements: { table: TABLE } },
  )) as [{ present: boolean }[], unknown];
  return rows[0]?.present === true;
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName();
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    if (!(await tableExists(sequelize, transaction))) {
      throw new Error(
        `0091: table ${TABLE} does not exist. Run db.sync() first (the backend does at boot); ` +
          "skipping would record this migration as applied with no append-only trigger.",
      );
    }
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0091: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "check it ran against this database (npm run migrate:status).",
      );
    }

    // 1–2. The functions and the triggers — the guarantee for every role.
    await run(sequelize, transaction, MASK_FUNCTION_SQL);
    await run(sequelize, transaction, FUNCTION_SQL);
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${ROW_TRIGGER} ON ${TABLE}`);
    await run(
      sequelize,
      transaction,
      `CREATE TRIGGER ${ROW_TRIGGER} BEFORE UPDATE OR DELETE ON ${TABLE} ` +
        `FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()`,
    );
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${TRUNCATE_TRIGGER} ON ${TABLE}`);
    await run(
      sequelize,
      transaction,
      `CREATE TRIGGER ${TRUNCATE_TRIGGER} BEFORE TRUNCATE ON ${TABLE} ` +
        `FOR EACH STATEMENT EXECUTE FUNCTION ${FUNCTION_NAME}()`,
    );
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER ${ROW_TRIGGER}`);
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER ${TRUNCATE_TRIGGER}`);

    // 3. The application role — the second layer.
    await run(sequelize, transaction, `REVOKE UPDATE, DELETE, TRUNCATE ON ${TABLE} FROM ${role}`);
    await run(sequelize, transaction, `GRANT UPDATE (${MASKABLE_COLUMNS.join(", ")}) ON ${TABLE} TO ${role}`);
  });
};

/**
 * Removes both triggers and both functions and gives the role back the
 * table-wide UPDATE and DELETE it had before (0057's grant). No audit row is
 * touched. The role itself is not dropped: it is cluster-wide.
 */
const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName();
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${ROW_TRIGGER} ON ${TABLE}`);
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${TRUNCATE_TRIGGER} ON ${TABLE}`);
    await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`);
    await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${MASK_FUNCTION}(jsonb, jsonb)`);
    if (await roleExists(sequelize, transaction, role)) {
      await run(sequelize, transaction, `GRANT UPDATE, DELETE ON ${TABLE} TO ${role}`);
    }
  });
};

export = {
  TABLE,
  FUNCTION_NAME,
  MASK_FUNCTION,
  ROW_TRIGGER,
  TRUNCATE_TRIGGER,
  MASKABLE_COLUMNS,
  PII_MASK,
  DEFAULT_APP_ROLE,
  appRoleName,
  up,
  down,
};
