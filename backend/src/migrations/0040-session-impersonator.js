"use strict";

/**
 * Adds `sessions.impersonator_id` (A-146).
 *
 * WHAT WAS WRONG
 *
 * impersonateUser (auth.service.js) puts the super admin's id in the access
 * token as `impersonatorId`, and that claim is what F-8 attributes audit rows
 * with and what A-127 (ADR-052) refuses Part 11 acts on. The session row did
 * not record it, so refreshUserToken — which rebuilds the access token from
 * the session — issued a token WITHOUT the claim: after one refresh an
 * impersonating operator's changes were audited as the hospital user alone,
 * and signing was no longer refused.
 *
 * WHAT THIS DOES
 *
 * One nullable UUID column, a foreign key to users ON DELETE CASCADE, and an
 * index. CASCADE because `sessions` is a throwaway table (0030 lists it as
 * CASCADE for its tenant) and a hard-deleted operator must not leave a live
 * session acting in their name. Existing rows stay NULL: an impersonation
 * session opened before this deploy is not recognisable as one, and it
 * expires within the hour it was issued for.
 *
 * The `sessions` model uses snake_case ATTRIBUTES (`user_id`, `tenant_id`), so
 * the attribute and the column are both `impersonator_id`; the test asserts
 * this against the model. The table has no `tenantId`.
 *
 * On a FRESH database `db.sync()` has already created the column from the
 * model and every step is a no-op.
 *
 * No blanket try/catch: only "the table does not exist yet" is a reason to
 * skip; anything else fails the migration rather than being recorded as
 * applied (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   \d sessions   -- impersonator_id uuid, FK to users(id) ON DELETE CASCADE, the index
 *
 * Idempotent + reversible (`down` revokes open impersonation sessions first).
 */
const TABLE = "sessions";
const COLUMN = "impersonator_id";
const INDEX = "sessions_impersonator_id";

/** Run by `down` before the column goes. */
const REVOKE_IMPERSONATION_SESSIONS =
  `UPDATE ${TABLE} SET is_revoked = true, is_active = false, revoked_at = now(), ` +
  `revoked_reason = 'MIGRATION_0040_DOWN' WHERE ${COLUMN} IS NOT NULL AND is_revoked = false`;

/** @param {object} DataTypes */
const columnSpec = (DataTypes) => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: "users", key: "id" },
  onDelete: "CASCADE",
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
  REVOKE_IMPERSONATION_SESSIONS,
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

  // Rolling back forgets which live sessions are impersonations, and a refresh
  // of one would then issue a token without the claim — the A-146 defect. So
  // `down` first REVOKES every open impersonation session (the operator starts
  // a new impersonation if they still need one), then drops the column.
  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    if (desc[COLUMN]) {
      await context.sequelize.query(REVOKE_IMPERSONATION_SESSIONS);
    }
    if (await hasIndex(context)) {
      await context.removeIndex(TABLE, INDEX);
    }
    if (desc[COLUMN]) {
      await context.removeColumn(TABLE, COLUMN);
    }
  },
};
