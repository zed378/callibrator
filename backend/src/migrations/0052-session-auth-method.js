"use strict";

/**
 * Adds `sessions.auth_method` (A-160, owner question "SSO users under the
 * tenant MFA policy").
 *
 * WHAT WAS WRONG
 *
 * A tenant's "MFA required" policy (A-160) sent every user without a local
 * TOTP authenticator to enrol one — including users who sign in through the
 * tenant's identity provider. Their SSO sign-in never asks for that TOTP, so
 * the enrolment protected nothing: the second factor of a federated sign-in
 * is the identity provider's.
 *
 * WHAT THIS DOES
 *
 * One nullable VARCHAR(32): "saml" or "oidc" for a session opened by single
 * sign-on (sso.controller issueSsoTokens), NULL for every other. The access
 * token carries it as `amr`; refreshUserToken re-issues it from the row, so a
 * refreshed SSO token is still recognised as federated. Existing rows stay
 * NULL — read as "not federated", the strict reading: an SSO session opened
 * before this deploy is asked to enrol, as it was before, until it signs in
 * again.
 *
 * The `sessions` model uses snake_case ATTRIBUTES, so the attribute and the
 * column are both `auth_method`; the test asserts this against the model.
 *
 * On a FRESH database `db.sync()` has already created the column from the
 * model and `up` is a no-op.
 *
 * No blanket try/catch: only "the table does not exist yet" is a reason to
 * skip; anything else fails the migration rather than being recorded as
 * applied (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   \d sessions   -- auth_method character varying(32), nullable
 *
 * Idempotent + reversible. `down` loses only the federated marker: an SSO
 * session is then asked to enrol MFA under a tenant policy, which is the
 * behaviour before this migration, not a weaker one.
 */
const TABLE = "sessions";
const COLUMN = "auth_method";

/** @param {object} DataTypes */
const columnSpec = (DataTypes) => ({
  type: DataTypes.STRING(32),
  allowNull: true,
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

module.exports = {
  TABLE,
  COLUMN,
  columnSpec,

  up: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc || desc[COLUMN]) {
      return;
    }
    await context.addColumn(TABLE, COLUMN, columnSpec(context.sequelize.Sequelize.DataTypes));
  },

  down: async ({ context }) => {
    const desc = await describeOrSkip(context);
    if (!desc || !desc[COLUMN]) {
      return;
    }
    await context.removeColumn(TABLE, COLUMN);
  },
};
