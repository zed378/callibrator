"use strict";

/**
 * Backfill the Profile page grant the seed never wrote (A-80).
 *
 * `ROLE_MENU_ASSIGNMENTS` granted every role `write` on `profile`; the seed
 * (`seedMenuGroups.util.js`) creates the Profile page as `profile-page`. The
 * assignment loop (`migration.service.js#seedMenuGroupsAndItems`) looks each
 * key up by slug, logged "Menu group not found: profile" and skipped it — for
 * all eleven roles, in every database ever seeded. Roles holding `account` still
 * saw the page through the parent's cascade; TECHNICIAN, HEALTHCARE TECHNICIAN,
 * FACILITY MAINTENANCE, WAREHOUSE STAFF and ROOM USER had no Profile entry.
 *
 * `MENU_SLUGS.PROFILE` is now `profile-page`, which fixes a database seeded from
 * now on. Seeding only CREATES missing rows, so an already-seeded database needs
 * this migration (the 0020/0021/0025 trap).
 *
 * What it does: gives every role below a `write` grant on `profile-page`,
 * exactly as ROLE_MENU_ASSIGNMENTS now does. A role that already has a row for
 * that group keeps it — this never overwrites a grant somebody set by hand.
 * On a database without a `profile-page` group (not seeded yet) or without the
 * roles, the INSERT … SELECT matches nothing and does nothing: the seed will
 * write the grants itself.
 *
 * The role list is frozen here rather than read from the constants, so what
 * this migration did cannot change after it has been recorded as applied.
 * `tests/migrations/0027-profile-page-grants.test.js` asserts it matched
 * ROLE_MENU_ASSIGNMENTS when it was written.
 *
 * `down` removes the `profile-page` grants of these roles. The seed never wrote
 * one before this migration, so the only rows `down` can remove that `up` did
 * not create are grants an administrator added by hand in the Menu Groups UI —
 * those are lost on rollback. Accepted: a rollback returns to the pre-A-80
 * state, in which no seeded role had the grant.
 *
 * Cache note (as 0021/0025): `getRolePermissionsMatrix` caches each role's
 * matrix in Redis for up to an hour under `cacheKeys.permissions(roleId)`.
 * Flush those keys after this runs, or the sidebar keeps the old menu until
 * they expire.
 *
 * No try/catch: a failure must fail the migration, not be recorded as applied
 * (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   SELECT r.name, p.permission_type
 *     FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id
 *     JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug = 'profile-page' ORDER BY r.name;
 */

const SLUG = "profile-page";

/** Every role ROLE_MENU_ASSIGNMENTS grants MENU_SLUGS.PROFILE, as of 2026-09-24. */
const GRANTED_ROLES = [
  "SUPERADMIN",
  "HEALTHCARE ADMIN",
  "CALIBRATOR ADMIN",
  "ENGINEERING MANAGER",
  "SUPERVISOR",
  "TECHNICIAN",
  "HEALTHCARE TECHNICIAN",
  "FACILITY MAINTENANCE",
  "WAREHOUSE STAFF",
  "ROOM USER",
  "USER",
];

module.exports = {
  SLUG,
  GRANTED_ROLES,

  async up({ context }) {
    const queryInterface = context.queryInterface || context;

    await queryInterface.sequelize.query(
      `INSERT INTO role_menu_permissions
              (id, role_id, menu_group_id, permission_type, created_at, updated_at)
       SELECT gen_random_uuid(), r.id, m.id, 'write', NOW(), NOW()
         FROM roles r
        CROSS JOIN menu_groups m
        WHERE m.slug = ?
          AND r.name IN (?)
          AND NOT EXISTS (
                SELECT 1 FROM role_menu_permissions x
                 WHERE x.role_id = r.id AND x.menu_group_id = m.id
              )`,
      { replacements: [SLUG, GRANTED_ROLES] },
    );
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;

    await queryInterface.sequelize.query(
      `DELETE FROM role_menu_permissions p
         USING roles r, menu_groups m
        WHERE p.role_id = r.id
          AND p.menu_group_id = m.id
          AND m.slug = ?
          AND r.name IN (?)`,
      { replacements: [SLUG, GRANTED_ROLES] },
    );
  },
};
