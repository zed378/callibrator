"use strict";

/**
 * Adds `users.must_change_password` (A-123, ADR-051 Q-11) and
 * `users.mfa_recovery_codes` (A-141).
 *
 * A-123. Since ADR-047 a password signs, so an administrator who chose a
 * user's password could sign as that user (ADR-051 F-3). An admin-created
 * account is now flagged; while the flag is set, auth.middleware answers 403
 * (code PASSWORD_CHANGE_REQUIRED) on every authenticated route except
 * change-password, logout and "who am I", and a successful change-password
 * (or an e-mail-code reset) clears it.
 *
 * EXISTING ROWS ARE NOT FLAGGED. The column defaults to false. An account an
 * administrator created before this migration, whose holder never changed the
 * password, still holds an admin-chosen password — and nothing in the schema
 * tells it apart from a self-registered account with `password_changed_at`
 * NULL. Flagging existing accounts is an owner decision, not a guess made
 * here (reported with A-123).
 *
 * A-141. One-time MFA recovery codes, issued when MFA is enabled or its
 * authenticator replaced. Stored as SHA-256 hashes (salted with the user id)
 * in a text[]; a code is consumed by a conditional UPDATE that removes its
 * hash only if it is still present — the same replay-safe shape as
 * `mfa_last_used_step` (mfa.service.js). NULL means "no codes".
 *
 * Why a column rather than a table: consumption, the LOGIN session and its
 * audit row, and the disable/rotation that replaces the set all happen in one
 * transaction on the user row; a text[] keeps them one row lock.
 *
 * The User model uses `underscored: true`; tests/migrations/0031-*.test.js
 * asserts these names equal the model's own `field` for each attribute. On a
 * FRESH database db.sync() has already created them and every step no-ops.
 *
 * No blanket try/catch: a failure must fail the migration, not be recorded as
 * applied (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   \d users   -- must_change_password boolean not null default false,
 *              -- mfa_recovery_codes text[]
 *
 * Idempotent + reversible.
 */
const TABLE = "users";

// Underscored column -> spec.
const COLUMNS = {
  must_change_password: (DataTypes) => ({
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  }),
  mfa_recovery_codes: (DataTypes) => ({
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: true,
  }),
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

  // Rolling back drops every issued recovery code (users who lost their
  // authenticator lose that way back in) and every pending forced change.
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
