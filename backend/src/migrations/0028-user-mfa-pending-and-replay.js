"use strict";

/**
 * Adds the TOTP enrolment and replay columns to `users` (A-114, A-115).
 *
 * A-114. `setupMfa` wrote the NEW secret straight into `mfa_secret`. On an
 * account that already had MFA, that replaced the live second factor the
 * moment setup was called — before any code from the new secret was shown to
 * work, and with no re-authentication, so a stolen session could swap the
 * factor out. The new secret is now held in `mfa_pending_secret` (issued at
 * `mfa_pending_created_at`) and only becomes `mfa_secret` when a code from it
 * is verified. `mfa.service.js` used to write a `mfaSecretTemp` property for
 * the same purpose; it was an attribute of no model and a column of no table,
 * so Sequelize dropped it on save().
 *
 * A-115. A TOTP code was accepted as often as it was presented inside its
 * ~90-second window. `mfa_last_used_step` records the last time step
 * (floor(epoch / 30)) accepted for the account; a code at or before it is a
 * replay and is refused.
 *
 * Why columns rather than Redis with a TTL for the pending secret: the
 * promotion, the replay stamp and the audit row are written in ONE database
 * transaction (auth.service.js#verifyMfaSetup), which Redis cannot join; and
 * Redis is optional in this deployment, so a pending enrolment held there
 * would vanish with a restart or be unavailable altogether. The TTL is
 * enforced in code from `mfa_pending_created_at`.
 *
 * The User model uses `underscored: true`; tests/migrations/0028-*.test.js
 * asserts these names equal the model's own `field` for each attribute.
 * `users` pre-dates these attributes (db.sync() never alters an existing
 * table), so the columns are added here; on a FRESH database sync() has
 * already created them from the model and every step is a no-op.
 *
 * Existing rows: all three columns start NULL. An enrolment that was in
 * progress under the old scheme (secret in `mfa_secret`, `mfa_enabled` false)
 * is not carried over — that user presses "Set up" again. An account with MFA
 * enabled keeps its `mfa_secret` untouched.
 *
 * No blanket try/catch: a failure must fail the migration, not be recorded as
 * applied (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   \d users   -- mfa_pending_secret, mfa_pending_created_at, mfa_last_used_step
 *
 * Idempotent + reversible.
 */
const TABLE = "users";

// Model attribute -> underscored column.
const COLUMNS = {
  mfa_pending_secret: (DataTypes) => ({ type: DataTypes.STRING(255), allowNull: true }),
  mfa_pending_created_at: (DataTypes) => ({ type: DataTypes.DATE, allowNull: true }),
  mfa_last_used_step: (DataTypes) => ({ type: DataTypes.INTEGER, allowNull: true }),
};

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

module.exports = {
  TABLE,
  COLUMNS,

  up: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }
    const DataTypes = context.sequelize.Sequelize.DataTypes;

    for (const [column, spec] of Object.entries(COLUMNS)) {
      if (!desc[column]) {
        await context.addColumn(TABLE, column, spec(DataTypes));
      }
    }
  },

  // Rolling back drops any enrolment in progress and the replay stamps: after
  // `down`, a code can be reused inside its window again (the pre-A-115 state).
  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc) {
      return;
    }

    for (const column of Object.keys(COLUMNS)) {
      if (desc[column]) {
        await context.removeColumn(TABLE, column);
      }
    }
  },
};
