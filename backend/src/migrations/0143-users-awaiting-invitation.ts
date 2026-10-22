/**
 * Migration 0143 — `users.awaiting_invitation` (P24-08; ADR-139 § 2, BACKLOG M-19).
 *
 * WHAT WAS WRONG
 *
 * The upstream transform's users step (P24-02b) imports every account with an unusable hash and
 * says the invitation is the only way in. It was not: the e-mail-code reset
 * (auth.service#requestOTP / #processResetPassword) and single sign-on's link by e-mail
 * (sso.service#provisionUser) open any account found by its address, and nothing told an imported
 * account apart from one an administrator created with a temporary password (A-123), for which the
 * reset is the intended way out.
 *
 * WHAT THIS DOES
 *
 *  1. One column, `awaiting_invitation boolean NOT NULL DEFAULT false`: every existing account is
 *     false (none was imported — the transform answers 409 until P24-03). The users step sets it
 *     true on insert; only accepting an invitation (P24-09) clears it. While it is true the reset
 *     sends nothing and refuses, and SSO does not link.
 *  2. `GRANT INSERT (awaiting_invitation) ON users` to the transform role — INSERT only: a re-run
 *     never reopens or closes an account, and the transform role has no UPDATE on it.
 *
 * On a FRESH database `db.sync()` has already created the column from the model; `up` then only
 * grants. No try/catch (CLAUDE.md): a failure fails the migration. Throws when the transform role is
 * absent (0133 creates it; PR-5). Verify with psql:
 *   \d users   -- awaiting_invitation boolean not null default false
 *   SELECT privilege_type FROM information_schema.column_privileges
 *    WHERE grantee = 'callibrator_transform' AND table_name = 'users' AND column_name = 'awaiting_invitation';
 *
 * `down` REFUSES while an account is awaiting its invitation (dropping the column would reopen it to
 * the reset and SSO); else it revokes the grant and drops the column.
 */
import type { DataTypes as SequelizeDataTypes, ModelAttributeColumnOptions, QueryInterface, Sequelize, Transaction } from "sequelize";
import m0133 from "./0133-upstream-import-transform";

/** The QueryInterface Umzug passes (P9-23: the context IS the QueryInterface). */
type Context = QueryInterface & { sequelize: Sequelize & { Sequelize: { DataTypes: typeof SequelizeDataTypes } } };

const TABLE = "users";
const COLUMN = "awaiting_invitation";
const LOCK_TIMEOUT = "10s";

const columnSpec = (DataTypes: typeof SequelizeDataTypes): ModelAttributeColumnOptions => ({
  type: DataTypes.BOOLEAN,
  allowNull: false,
  defaultValue: false,
});

const truthy = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Record<string, unknown> = {}): Promise<boolean> => {
  const [result] = (await sequelize.query(`SELECT (${statement}) AS yes`, { transaction, replacements })) as [Record<string, unknown>[], unknown];
  return result[0]?.["yes"] === true;
};

/** The transform role, checked present. */
const transformRoleOf = async (sequelize: Sequelize, transaction: Transaction): Promise<string> => {
  const role = m0133.roleName("UPSTREAM_TRANSFORM_DB_ROLE", m0133.DEFAULT_TRANSFORM_ROLE);
  if (!(await truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role)", { role }))) {
    throw new Error(`0143: the transform role "${role}" does not exist. Migration 0133 comes first; run the migrations in order.`);
  }
  return role;
};

const up = async ({ context }: { context: Context }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
    const role = await transformRoleOf(sequelize, transaction);
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, columnSpec(sequelize.Sequelize.DataTypes), { transaction });
    }
    await sequelize.query(`GRANT INSERT (${COLUMN}) ON ${TABLE} TO ${role}`, { transaction });
  });
};

const down = async ({ context }: { context: Context }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
    const role = await transformRoleOf(sequelize, transaction);
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      return;
    }
    if (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${TABLE} WHERE ${COLUMN})`)) {
      throw new Error("0143 down: an account is awaiting its invitation; dropping the column would open it to the reset and SSO. Refusing.");
    }
    await sequelize.query(`REVOKE INSERT (${COLUMN}) ON ${TABLE} FROM ${role}`, { transaction });
    await context.removeColumn(TABLE, COLUMN, { transaction });
  });
};

export = { TABLE, COLUMN, columnSpec, up, down };
