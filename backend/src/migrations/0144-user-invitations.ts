/**
 * Migration 0144 — `user_invitations`, the single-use invitation of an imported user (P24-09a;
 * ADR-139 § 3 – § 4).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. The table, unless it exists — db.sync() runs BEFORE the migrations at boot and creates it from
 *     the model on a database that has never seen it. `created_at` gets the server default `now()`.
 *  2. CHECKs (sync never creates one): the hash is 64 lower-case hex characters; the revoke reason is
 *     `reissued` or `revoked`; the three revoke columns are set together, by a person, or not at all;
 *     an invitation is never both accepted and revoked; it expires after it was issued.
 *  3. Indexes, every one here and none on the model (ADR-100 Am. 3): the hash UNIQUE, **global** —
 *     the reviewed exception ADR-138 § 2 made for a hash of a random token (a SHA-256 of 256 random
 *     bits is no existence oracle), needed because the acceptance arrives with no tenant; ONE live
 *     invitation per user (partial UNIQUE `(tenant_id, user_id) WHERE accepted_at IS NULL AND
 *     revoked_at IS NULL`); a leading index on each foreign key (D-20).
 *  4. Triggers, ENABLE ALWAYS, ERRCODE 42501:
 *     - `user_invitations_append_only` (+ `_no_truncate`): DELETE and TRUNCATE refused; a row that is
 *       accepted or revoked never changes again; otherwise only `accepted_at` or the revoke columns
 *       may be set — nothing else ever changes;
 *     - `user_invitations_same_tenant` (BEFORE INSERT): the invited user is the row's tenant's.
 *  5. Grants of the application role: SELECT, INSERT, UPDATE (accepted_at and the revoke columns);
 *     no DELETE, no TRUNCATE.
 *
 * Throws, never skips, when a prerequisite is absent (PR-5). No try/catch. Verify with psql, not
 * the log:
 *   \d user_invitations
 *   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'user_invitations'::regclass;
 *
 * `down` REFUSES while the table holds a row (dropping it would void every invitation sent and lose
 * who invited whom); otherwise drops the table and its two functions.
 */
import { DataTypes, type ModelAttributeColumnOptions, type QueryInterface } from "sequelize";
import { USER_INVITATION_REVOKED_REASONS } from "@callibrator/contracts/userInvitations";
import {
  LOCK_TIMEOUT,
  appRoleName,
  constraintNames,
  createAlwaysTrigger,
  requireTables,
  roleExists,
  rows,
  run,
  sqlList,
  tableExists,
} from "./facilityMigration.shared";

const TABLE = "user_invitations";

/** The tables `up` needs before it starts. */
const PREREQUISITES = Object.freeze(["tenants", "users"]);

const fk = (table: string, allowNull: boolean): ModelAttributeColumnOptions => ({
  type: DataTypes.UUID,
  allowNull,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** The table as the model declares it (tests/migrations/0144 holds them equal). */
const TABLE_COLUMNS: Readonly<Record<string, ModelAttributeColumnOptions>> = Object.freeze({
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
  tenant_id: fk("tenants", false),
  user_id: fk("users", false),
  token_hash: { type: DataTypes.CHAR(64), allowNull: false },
  issued_by: fk("users", false),
  created_at: { type: DataTypes.DATE, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  accepted_at: { type: DataTypes.DATE, allowNull: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_by: fk("users", true),
  revoked_reason: { type: DataTypes.STRING(16), allowNull: true },
});

/** CHECK name -> predicate. */
const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  user_invitations_hash_shape: "token_hash ~ '^[0-9a-f]{64}$'",
  user_invitations_revoked_reason: `revoked_reason IS NULL OR revoked_reason IN (${sqlList(USER_INVITATION_REVOKED_REASONS)})`,
  user_invitations_revoke_together:
    "(revoked_at IS NULL AND revoked_by IS NULL AND revoked_reason IS NULL) OR " +
    "(revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoked_reason IS NOT NULL)",
  user_invitations_accepted_or_revoked: "accepted_at IS NULL OR revoked_at IS NULL",
  user_invitations_expires_after_issue: "expires_at > created_at",
});

/** The index names, in creation order. */
const INDEX_NAMES = Object.freeze([
  "user_invitations_token_hash_unique",
  "user_invitations_one_live_per_user",
  "user_invitations_tenant_id",
  "user_invitations_user_id",
  "user_invitations_issued_by",
  "user_invitations_revoked_by",
]);

const INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_token_hash_unique ON ${TABLE} (token_hash)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_one_live_per_user ON ${TABLE} (tenant_id, user_id) WHERE accepted_at IS NULL AND revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS user_invitations_tenant_id ON ${TABLE} (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS user_invitations_user_id ON ${TABLE} (user_id)`,
  `CREATE INDEX IF NOT EXISTS user_invitations_issued_by ON ${TABLE} (issued_by)`,
  `CREATE INDEX IF NOT EXISTS user_invitations_revoked_by ON ${TABLE} (revoked_by)`,
]);

/** The trigger functions, by name. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "user_invitations_append_only",
    `
CREATE OR REPLACE FUNCTION user_invitations_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'user_invitations is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_invitations is append-only: invitation % cannot be deleted', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'user_invitations: invitation % is spent and cannot change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'user_invitations: only the acceptance or the revoke columns of invitation % may change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
  [
    "user_invitations_same_tenant",
    `
CREATE OR REPLACE FUNCTION user_invitations_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'user_invitations: user % is not of tenant %', NEW.user_id, NEW.tenant_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
]);

/** [table, trigger name, definition after CREATE]. */
const TRIGGERS: readonly (readonly [table: string, name: string, definition: string])[] = Object.freeze([
  [TABLE, "user_invitations_append_only", `TRIGGER user_invitations_append_only BEFORE UPDATE OR DELETE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION user_invitations_append_only()`],
  [TABLE, "user_invitations_no_truncate", `TRIGGER user_invitations_no_truncate BEFORE TRUNCATE ON ${TABLE} FOR EACH STATEMENT EXECUTE FUNCTION user_invitations_append_only()`],
  [TABLE, "user_invitations_same_tenant", `TRIGGER user_invitations_same_tenant BEFORE INSERT ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION user_invitations_same_tenant()`],
]);

/** The application role's privileges: [granted, revoked]. */
const GRANTS = Object.freeze({
  granted: "SELECT, INSERT, UPDATE (accepted_at, revoked_at, revoked_by, revoked_reason)",
  revoked: "DELETE, TRUNCATE",
});

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName("0144");
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0144", PREREQUISITES);
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0144: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "run the migrations in order, or create it as an administrator (see 0057).",
      );
    }

    // 1. The table (sync() made it on a database that never had it).
    if (!(await tableExists(sequelize, transaction, TABLE))) {
      await context.createTable(TABLE, { ...TABLE_COLUMNS }, { transaction });
    }
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ALTER COLUMN created_at SET DEFAULT now()`);

    // 2. CHECKs.
    for (const [name, predicate] of Object.entries(CHECKS)) {
      if (!(await constraintNames(sequelize, transaction, TABLE)).has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }

    // 3. Indexes.
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 4. Functions, then the triggers.
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    for (const [table, name, definition] of TRIGGERS) {
      await createAlwaysTrigger(sequelize, transaction, table, name, definition);
    }

    // 5. Grants (a column-level UPDATE: first take away any table-level one).
    await run(sequelize, transaction, `REVOKE UPDATE ON ${TABLE} FROM ${role}`);
    await run(sequelize, transaction, `GRANT ${GRANTS.granted} ON ${TABLE} TO ${role}`);
    await run(sequelize, transaction, `REVOKE ${GRANTS.revoked} ON ${TABLE} FROM ${role}`);
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    if (await tableExists(sequelize, transaction, TABLE)) {
      const [row] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${TABLE}`);
      const n = Number(row?.["n"]);
      if (n > 0) {
        throw new Error(
          `0144 down: the database holds ${String(n)} user invitation(s). Reverting would void every invitation sent ` +
            "and lose who invited whom; restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
        );
      }
    }
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${TABLE}`);
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
};

export = {
  TABLE,
  TABLE_COLUMNS,
  CHECKS,
  INDEX_NAMES,
  INDEX_SQL,
  FUNCTIONS,
  TRIGGERS,
  GRANTS,
  up,
  down,
};
