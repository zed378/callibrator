/**
 * Migration 0137 — `public_device_tokens`, a device's public link (P21-08; ADR-138 § 1 – 2 and
 * Am. 1; spec MEMORY/specs/P19-07-public-device-page.md § 5).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. The table, unless it exists — db.sync() runs BEFORE the migrations at boot and creates it from
 *     the model on a database that has never seen it. `created_at` gets the server default `now()`.
 *  2. CHECKs (sync never creates one): the hash is 64 lower-case hex characters; the revoke reason
 *     is one of `rotated` / `revoked` / `device_deleted`; the revoke columns are set together or not
 *     at all — `revoked_by` may stay NULL only for `device_deleted` (a delete with no user actor).
 *  3. Indexes, every one here and none on the model (ADR-100 Am. 3): the hash UNIQUE, **global** —
 *     ADR-138 § 2's reviewed exception to the "no global uniqueness" trap (a SHA-256 of a 128-bit
 *     random value cannot be enumerated, so it is no existence oracle); ONE active link per device
 *     (partial UNIQUE `(tenant_id, device_id) WHERE revoked_at IS NULL`); a leading index on each
 *     foreign key (D-20).
 *  4. Triggers, ENABLE ALWAYS (they bind every role, the owner too, and survive
 *     `session_replication_role = replica`), ERRCODE 42501:
 *     - `public_device_tokens_append_only` (+ `_no_truncate`): DELETE and TRUNCATE refused; an
 *       UPDATE may only set the three revoke columns, once, from NULL — nothing else ever changes;
 *     - `public_device_tokens_same_tenant` (BEFORE INSERT): the device is the row's tenant's.
 *  5. Grants of the application role: SELECT, INSERT, UPDATE (revoke columns only); no DELETE, no
 *     TRUNCATE.
 *
 * Independent of every other upstream migration (0133 … 0136 and 0138 touch other tables): it
 * needs only `tenants`, `users`, `calibration_devices` and the application role.
 *
 * Throws, never skips, when a prerequisite is absent (PR-5). No try/catch. Verify with psql, not
 * the log:
 *   \d public_device_tokens
 *   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public_device_tokens'::regclass;
 *
 * `down` REFUSES while the table holds a row (dropping it would revoke every printed sticker
 * silently and lose the history); otherwise drops the table and its two functions.
 */
import { DataTypes, type ModelAttributeColumnOptions, type QueryInterface } from "sequelize";
import { PUBLIC_DEVICE_TOKEN_REVOKED_REASONS } from "@callibrator/contracts/publicDevices";
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

const TABLE = "public_device_tokens";

/** The tables `up` needs before it starts. */
const PREREQUISITES = Object.freeze(["tenants", "users", "calibration_devices"]);

const fk = (table: string, allowNull: boolean): ModelAttributeColumnOptions => ({
  type: DataTypes.UUID,
  allowNull,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** The table as the model declares it (tests/migrations/0137 holds them equal). */
const TABLE_COLUMNS: Readonly<Record<string, ModelAttributeColumnOptions>> = Object.freeze({
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
  tenant_id: fk("tenants", false),
  device_id: fk("calibration_devices", false),
  token_hash: { type: DataTypes.CHAR(64), allowNull: false },
  created_by: fk("users", false),
  created_at: { type: DataTypes.DATE, allowNull: false },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_by: fk("users", true),
  revoked_reason: { type: DataTypes.STRING(16), allowNull: true },
});

/** CHECK name -> predicate. */
const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  public_device_tokens_hash_shape: "token_hash ~ '^[0-9a-f]{64}$'",
  public_device_tokens_revoked_reason: `revoked_reason IS NULL OR revoked_reason IN (${sqlList(PUBLIC_DEVICE_TOKEN_REVOKED_REASONS)})`,
  public_device_tokens_revoke_together:
    "(revoked_at IS NULL AND revoked_by IS NULL AND revoked_reason IS NULL) OR " +
    "(revoked_at IS NOT NULL AND revoked_reason IS NOT NULL AND (revoked_by IS NOT NULL OR revoked_reason = 'device_deleted'))",
});

/** The index names, in creation order. */
const INDEX_NAMES = Object.freeze([
  "public_device_tokens_token_hash_unique",
  "public_device_tokens_one_active_per_device",
  "public_device_tokens_tenant_id",
  "public_device_tokens_device_id",
  "public_device_tokens_created_by",
  "public_device_tokens_revoked_by",
]);

const INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS public_device_tokens_token_hash_unique ON ${TABLE} (token_hash)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS public_device_tokens_one_active_per_device ON ${TABLE} (tenant_id, device_id) WHERE revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS public_device_tokens_tenant_id ON ${TABLE} (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS public_device_tokens_device_id ON ${TABLE} (device_id)`,
  `CREATE INDEX IF NOT EXISTS public_device_tokens_created_by ON ${TABLE} (created_by)`,
  `CREATE INDEX IF NOT EXISTS public_device_tokens_revoked_by ON ${TABLE} (revoked_by)`,
]);

/** The trigger functions, by name. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "public_device_tokens_append_only",
    `
CREATE OR REPLACE FUNCTION public_device_tokens_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'public_device_tokens is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'public_device_tokens is append-only: link % cannot be deleted', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'public_device_tokens: link % is revoked and cannot change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'public_device_tokens: only the revoke columns of link % may change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
  [
    "public_device_tokens_same_tenant",
    `
CREATE OR REPLACE FUNCTION public_device_tokens_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM calibration_devices d WHERE d.id = NEW.device_id AND d.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'public_device_tokens: device % is not of tenant %', NEW.device_id, NEW.tenant_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$`,
  ],
]);

/** [table, trigger name, definition after CREATE]. */
const TRIGGERS: readonly (readonly [table: string, name: string, definition: string])[] = Object.freeze([
  [TABLE, "public_device_tokens_append_only", `TRIGGER public_device_tokens_append_only BEFORE UPDATE OR DELETE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION public_device_tokens_append_only()`],
  [TABLE, "public_device_tokens_no_truncate", `TRIGGER public_device_tokens_no_truncate BEFORE TRUNCATE ON ${TABLE} FOR EACH STATEMENT EXECUTE FUNCTION public_device_tokens_append_only()`],
  [TABLE, "public_device_tokens_same_tenant", `TRIGGER public_device_tokens_same_tenant BEFORE INSERT ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION public_device_tokens_same_tenant()`],
]);

/** The application role's privileges: [granted, revoked]. */
const GRANTS = Object.freeze({
  granted: "SELECT, INSERT, UPDATE (revoked_at, revoked_by, revoked_reason)",
  revoked: "DELETE, TRUNCATE",
});

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName("0137");
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0137", PREREQUISITES);
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0137: the application role "${role}" does not exist. Migration 0057 creates it; ` +
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
          `0137 down: the database holds ${String(n)} public device link(s). Reverting would silently break every printed ` +
            "sticker and lose their history; restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
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
