"use strict";

/**
 * Q-20 (ADR-056) — grants for the Management pages only SUPERADMIN
 * could reach.
 *
 * `users`, `vendors`, `billing`, `audit` and `content` are seeded pages two
 * levels under `management` (management → mgmt-* → page). ROLE_MENU_ASSIGNMENTS
 * granted `management`, and roles.service#getRolePermissionsMatrix inherits a
 * grant ONE level down, so on a fresh install their routes (`/users`,
 * `/vendors`, `/billing`, `/audit`, `/content`) passed for SUPERADMIN only —
 * a HEALTHCARE ADMIN could not manage its own tenant's users.
 *
 * The decision (see roleConstants ROLE_MENU_ASSIGNMENTS):
 *   HEALTHCARE ADMIN, CALIBRATOR ADMIN — users write, vendors write,
 *                                        billing read, audit read
 *   ENGINEERING MANAGER                — vendors read
 *   content                            — nobody: the platform-wide blog
 *
 * Seeding creates missing grants only for a database seeded from now on; this
 * does the same for an already-seeded one (the 0021/0025/0038 trap).
 *
 *  - A role that already has a row for the page KEEPS it — a grant set by hand
 *    (stronger or weaker) is never overwritten.
 *  - A role or page that does not exist is skipped (nothing to grant).
 *  - On a database that has NOT been seeded (no `home` menu group), this does
 *    nothing: the seed creates the grants itself.
 *
 * Cache note (as 0021/0025/0027/0038): each role's matrix is cached in Redis
 * for up to an hour. Flush `<prefix>permissions:*` after this runs.
 *
 * No try/catch: a failure must fail the migration, not be recorded as applied
 * (CLAUDE.md). Verify with psql, not the log:
 *   SELECT r.name, m.slug, p.permission_type
 *     FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id
 *     JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug IN ('users','vendors','billing','audit','content')
 *    ORDER BY m.slug, r.name;
 */

/** [roleName, slug, permissionType] — the grants this migration adds. */
const GRANTS = Object.freeze([
  ["HEALTHCARE ADMIN", "users", "write"],
  ["HEALTHCARE ADMIN", "vendors", "write"],
  ["HEALTHCARE ADMIN", "billing", "read"],
  ["HEALTHCARE ADMIN", "audit", "read"],
  ["CALIBRATOR ADMIN", "users", "write"],
  ["CALIBRATOR ADMIN", "vendors", "write"],
  ["CALIBRATOR ADMIN", "billing", "read"],
  ["CALIBRATOR ADMIN", "audit", "read"],
  ["ENGINEERING MANAGER", "vendors", "read"],
]);

module.exports = {
  GRANTS,

  async up({ context }) {
    const queryInterface = context.queryInterface || context;

    const [seeded] = await queryInterface.sequelize.query(
      "SELECT id FROM menu_groups WHERE slug = 'home'",
    );
    if (seeded.length === 0) {
      return; // not seeded yet — the seed creates the grants
    }

    for (const [roleName, slug, permissionType] of GRANTS) {
      await queryInterface.sequelize.query(
        `INSERT INTO role_menu_permissions
                (id, role_id, menu_group_id, permission_type, created_at, updated_at)
         SELECT gen_random_uuid(), r.id, m.id, ?, NOW(), NOW()
           FROM roles r
          CROSS JOIN menu_groups m
          WHERE r.name = ?
            AND m.slug = ?
            AND NOT EXISTS (
                  SELECT 1 FROM role_menu_permissions x
                   WHERE x.role_id = r.id AND x.menu_group_id = m.id
                )`,
        { replacements: [permissionType, roleName, slug] },
      );
    }
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;

    // Back to SUPERADMIN-only. A grant of the same (role, page) an
    // administrator added by hand before this ran is removed too — the table
    // records no provenance. Accepted: the rollback restores the documented
    // pre-Q-20 defaults.
    for (const [roleName, slug, permissionType] of GRANTS) {
      await queryInterface.sequelize.query(
        `DELETE FROM role_menu_permissions p
           USING roles r, menu_groups m
          WHERE p.role_id = r.id
            AND p.menu_group_id = m.id
            AND r.name = ?
            AND m.slug = ?
            AND p.permission_type = ?`,
        { replacements: [roleName, slug, permissionType] },
      );
    }
  },
};
