"use strict";

/**
 * Adds `users.temporary_password_expires_at` (A-215, ADR-068).
 *
 * WHAT WAS WRONG
 *
 * A password an administrator chose — at user creation, or by the admin
 * reset (user.service#resetUserPassword) — is flagged `must_change_password`
 * (A-123), but it signed in forever. A temporary password handed over on
 * paper, or in a chat, was a standing credential until its holder happened to
 * sign in.
 *
 * WHAT THIS DOES
 *
 * 1. One nullable TIMESTAMPTZ. The create and the reset set it to 72 hours
 *    ahead (user.service TEMPORARY_PASSWORD_TTL_MS); the holder's own change,
 *    or an e-mail-code reset, clears it. Past it, sign-in answers the same 401
 *    as a wrong password (auth.service#loginUser).
 * 2. A backfill: every account still flagged `must_change_password` holds an
 *    administrator's password that predates this column. Its clock starts
 *    NOW — it gets the same 72 hours from the upgrade, not "never", and not
 *    "already expired" (which would lock out, unannounced, every account an
 *    administrator created and whose holder has not signed in yet).
 *
 * On a FRESH database `db.sync()` has already created the column from the
 * model; `up` then only runs the backfill, which matches no row.
 *
 * No try/catch at all (D-14): boot runs db.sync() before the migrator, so
 * `users` exists, and any failure must fail the migration rather than be
 * recorded as applied. Verify with psql, not the log:
 *   \d users   -- temporary_password_expires_at timestamp with time zone
 *
 * Idempotent: the column is added only when absent, and the backfill touches
 * only flagged rows whose expiry is still NULL — a re-run after the upgrade
 * finds none, because every flag written since carries its expiry.
 *
 * `down` drops the column: temporary passwords then never expire again, which
 * is the behaviour before this migration, not a weaker one.
 */
const TABLE = "users";
const COLUMN = "temporary_password_expires_at";
const TTL_HOURS = 72;

/** @param {object} DataTypes */
const columnSpec = (DataTypes) => ({
  type: DataTypes.DATE,
  allowNull: true,
});

const BACKFILL_SQL = `UPDATE "${TABLE}"
   SET "${COLUMN}" = now() + interval '${TTL_HOURS} hours'
 WHERE must_change_password = true
   AND "${COLUMN}" IS NULL`;

module.exports = {
  TABLE,
  COLUMN,
  TTL_HOURS,
  BACKFILL_SQL,
  columnSpec,

  up: async ({ context }) => {
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      await context.addColumn(TABLE, COLUMN, columnSpec(context.sequelize.Sequelize.DataTypes));
    }
    await context.sequelize.query(BACKFILL_SQL);
  },

  down: async ({ context }) => {
    const desc = await context.describeTable(TABLE);
    if (!desc[COLUMN]) {
      return;
    }
    await context.removeColumn(TABLE, COLUMN);
  },
};
