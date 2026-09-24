"use strict";

/**
 * A-163 — flag the accounts created before A-123 that still hold the password
 * an administrator chose.
 *
 * WHAT WAS WRONG
 *
 * Since A-123 (migration 0031, ADR-051 Q-11) userCreate sets
 * `users.must_change_password`, so the holder must replace the admin-chosen
 * password before anything else — since ADR-047 a password signs. 0031 added
 * the column with default false: every account an administrator created
 * BEFORE it was left unflagged, and the administrator who chose its password
 * can still sign as its holder.
 *
 * DECISION (orchestrator, A-163): flag the accounts that have NEVER SIGNED IN.
 * They certainly still hold the password they were given. An account that has
 * signed in is not flagged: whether its holder changed the password is not
 * knowable from the schema.
 *
 * WHAT IS FLAGGED — every live account for which ALL of these hold:
 *  - not already flagged;
 *  - `last_login_at IS NULL` — never signed in with a password;
 *  - `password_changed_at IS NULL` — the password was never changed or reset
 *    (justUpdatePassword and the e-mail-code reset both set it), so it is the
 *    one it was created with;
 *  - no other trace of a sign-in: no MFA and no passkey enrolled (enrolling
 *    needs a signed-in session), no row in `sessions`, and no LOGIN row in
 *    `audit_logs` (SSO sign-ins write both but never set last_login_at);
 *  - not the platform operator: not the seeded system user (sys@mail.com,
 *    migration.service.js DEFAULT_SYSTEM_USERS) and not any SUPERADMIN-role
 *    account. The super admin is the recovery path for every other account;
 *    a new one is flagged by userCreate anyway;
 *  - not SSO-provisioned. Nothing in `users` marks an account SSO/SCIM
 *    provisioned (both give it a random password nobody knows). Flagging one
 *    would send an SSO user to a change-password screen asking for a
 *    "current password" they never had. So in a tenant that has EVER had SSO
 *    configured (a `tenant_settings` row `sso_enabled`, whatever its value),
 *    an account is flagged only when an audit row proves an ADMINISTRATOR
 *    created it (`audit_logs` CREATE on resource_type 'User' by a user
 *    actor) — which userCreate has written since A-77. A SCIM-provisioned
 *    account in a tenant without SSO may be flagged; that costs nothing, its
 *    only way in is the e-mail-code reset, which clears the flag.
 *
 * Deleted accounts (soft or paranoid) are left alone.
 *
 * REPORTS the count on the console (console.warn, as 0032 does) and returns
 * it. Verify with psql, not the log:
 *   SELECT count(*) FROM users WHERE must_change_password AND last_login_at IS NULL;
 *
 * IDEMPOTENT: a flagged account is excluded by the first condition, and one
 * whose holder has since changed the password is excluded by
 * password_changed_at. NOT REVERSIBLE: `down` does nothing — it cannot tell
 * the accounts flagged here from those userCreate flagged, and clearing the
 * flag would restore the administrator's ability to sign as the holder.
 *
 * REFUSES, does not skip, when `users`, its `must_change_password` column
 * (0031), `sessions`, `audit_logs` or `tenant_settings` is missing: db.sync()
 * runs before migrations at boot, so a missing one is a broken database, and
 * a skip would be recorded as applied while flagging nothing (0008/0013/0014).
 *
 * No try/catch (CLAUDE.md).
 */

/** migration.service.js DEFAULT_SYSTEM_USERS — the seeded platform operator. */
const SEEDED_SYSTEM_EMAILS = Object.freeze(["sys@mail.com"]);
/** constants/roleConstants.js ROLE_IDS.SUPER_ADMIN — frozen here: a migration
 *  must mean the same thing whenever it runs. */
const SUPER_ADMIN_ROLE_ID = "9be20605-cc6a-4d91-8246-9756b4a1754b";

const REQUIRED_TABLES = Object.freeze(["users", "sessions", "audit_logs", "tenant_settings"]);

const FLAG_SQL = `
  UPDATE users u
     SET must_change_password = true,
         updated_at = now()
   WHERE u.must_change_password = false
     AND u.last_login_at IS NULL
     AND u.password_changed_at IS NULL
     AND u.deleted_at IS NULL
     AND u.is_deleted = false
     AND u.mfa_enabled IS NOT TRUE
     AND u.webauthn_enabled IS NOT TRUE
     AND lower(u.email) NOT IN (:seededEmails)
     AND u.role_id IS DISTINCT FROM CAST(:superAdminRoleId AS uuid)
     AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id)
     AND NOT EXISTS (
           SELECT 1 FROM audit_logs a
            WHERE a.user_id = u.id AND a.action::text = 'LOGIN')
     AND (
           NOT EXISTS (
             SELECT 1 FROM tenant_settings ts
              WHERE ts.tenant_id = u.tenant_id AND ts.key = 'sso_enabled')
           OR EXISTS (
             SELECT 1 FROM audit_logs c
              WHERE c.resource_type = 'User'
                AND c.resource_id = u.id::text
                AND c.action::text = 'CREATE'
                AND c.user_id IS NOT NULL
                AND c.user_id <> u.id)
         )
  RETURNING u.id`;

const assertSchema = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT t.name,
            to_regclass(current_schema() || '.' || t.name) IS NOT NULL AS present
       FROM unnest(ARRAY[:tables]::text[]) AS t(name)`,
    { transaction, replacements: { tables: REQUIRED_TABLES } },
  );
  const missing = rows.filter((r) => !r.present).map((r) => r.name);
  if (missing.length) {
    throw new Error(
      `0036: table(s) ${missing.join(", ")} do not exist. Run db.sync() first (the backend does at boot).`,
    );
  }
  const [cols] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'users'
        AND column_name = 'must_change_password'`,
    { transaction },
  );
  if (!cols.length) {
    throw new Error("0036: users.must_change_password does not exist. Migration 0031 must run first.");
  }
};

module.exports = {
  SEEDED_SYSTEM_EMAILS,
  SUPER_ADMIN_ROLE_ID,
  FLAG_SQL,

  up: async ({ context }) => {
    const { sequelize } = context;
    return sequelize.transaction(async (transaction) => {
      await assertSchema(sequelize, transaction);
      const [flagged] = await sequelize.query(FLAG_SQL, {
        transaction,
        replacements: {
          seededEmails: SEEDED_SYSTEM_EMAILS,
          superAdminRoleId: SUPER_ADMIN_ROLE_ID,
        },
      });
      console.warn(
        `0036: flagged ${flagged.length} never-signed-in account(s) to change the password an ` +
          "administrator set before A-123 (users.must_change_password). They are sent to the " +
          "change-password screen at their first sign-in.",
      );
      return flagged.length;
    });
  },

  // Deliberately nothing: see the header.
  down: async () => {},
};
