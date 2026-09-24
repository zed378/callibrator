"use strict";

/**
 * Adds `audit_logs.impersonator_id` (F-8, TASKS/DEBATE-owner-questions-A-compliance.md §0).
 *
 * impersonateUser (auth.service.js) issues the hospital user's access token
 * with an `impersonatorId` claim, and nothing read it back: every change a
 * super admin made while impersonating was audited as the hospital user, and
 * only the impersonation session's LOGIN row connected the two. The auth
 * middleware now reads the claim and audit.service#logAction records it here.
 *
 * Why a column rather than `changes.impersonatorId`: `changes` is the caller's
 * before/after payload, written by dozens of services in their own shapes; the
 * operator is a property of the ACTOR, like `user_id`, and must be queryable
 * ("everything OP-n did in this tenant") without a JSON path on every row.
 *
 * The foreign key mirrors `user_id`: ON DELETE SET NULL. The implication, the
 * same one `user_id` already has: hard-deleting the super admin's user row
 * erases WHO impersonated from every row. Users are soft-deleted in normal
 * operation; the FK-behaviour question for audit rows is Q-16 and is not
 * decided here.
 *
 * The AuditLog model uses `underscored: true`; tests/migrations/0029-*.test.js
 * asserts the column name equals the model's own `field`. `audit_logs`
 * pre-dates the attribute (db.sync() never alters an existing table), so the
 * column is added here; on a FRESH database sync() has already created it from
 * the model and every step is a no-op.
 *
 * Existing rows: NULL — no impersonator is recorded for anything written
 * before this deploy. That history cannot be recovered from audit_logs; the
 * impersonation session's LOGIN row (changes.impersonatorId) is the only link.
 *
 * No blanket try/catch: a failure must fail the migration, not be recorded as
 * applied (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   \d audit_logs   -- impersonator_id uuid, FK to users(id), the index below
 *
 * Idempotent + reversible.
 */
const TABLE = "audit_logs";
const COLUMN = "impersonator_id";
const INDEX = "audit_logs_impersonator_id";

/** @param {object} DataTypes */
const columnSpec = (DataTypes) => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: "users", key: "id" },
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

/**
 * Only "this table doesn't exist yet" is a reason to skip. Anything else is a
 * real failure and must surface.
 */
const describeOrSkip = async (queryInterface) => {
  try {
    return await queryInterface.describeTable(TABLE);
  } catch (err) {
    if (/no description found|does not exist/i.test(err.message || "")) {
      return null; // table not present yet — db.sync() will create it whole
    }
    throw err;
  }
};

const hasIndex = async (queryInterface) => {
  const indexes = await queryInterface.showIndex(TABLE);
  return indexes.some((index) => index.name === INDEX);
};

module.exports = {
  TABLE,
  COLUMN,
  INDEX,
  columnSpec,

  up: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    const DataTypes = context.sequelize.Sequelize.DataTypes;

    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, columnSpec(DataTypes));
    }
    if (!(await hasIndex(context))) {
      await context.addIndex(TABLE, [COLUMN], { name: INDEX });
    }
  },

  // Rolling back drops the attribution of every change made under
  // impersonation since the deploy — the pre-F-8 state. Take a copy first if
  // those rows matter: SELECT id, impersonator_id FROM audit_logs WHERE impersonator_id IS NOT NULL.
  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    if (await hasIndex(context)) {
      await context.removeIndex(TABLE, INDEX);
    }
    if (desc[COLUMN]) {
      await context.removeColumn(TABLE, COLUMN);
    }
  },
};
