"use strict";

/**
 * The `ai-assistant` menu entry and its grants (A-118).
 *
 * /dashboard/ai-assistant existed with no menu entry: nobody could find it,
 * and a user who typed the URL got an error toast from a 403 they could not
 * explain. The seed (`seedMenuGroups.util.js`, `ROLE_MENU_ASSIGNMENTS`) now
 * creates the entry under Quality & Compliance and grants it to the roles that
 * hold `sop` — but seeding creates missing rows only for a database seeded
 * from now on. This migration does the same for an already-seeded database
 * (the 0020/0021/0025 trap).
 *
 * WHO GETS IT. The entry is visibility only; the page's two calls stay gated
 * by the slugs of what they touch — POST /ai/ocr on `certificate` write, POST
 * /ai/query on `sop` read. So the entry goes to every role that can use at
 * least one of them, READ FROM THE ROLE'S CURRENT GRANTS rather than from a
 * frozen role list, because a deployment may have customised them:
 *  - any grant on `sop`, or on its parent `mgmt-quality` (the permission
 *    matrix cascades a grant one level down — roles.service
 *    #getRolePermissionsMatrix); or
 *  - `write` on `certificate`, or on its parent `equipment`.
 * On the seeded defaults that is SUPERADMIN, HEALTHCARE ADMIN, CALIBRATOR
 * ADMIN and ENGINEERING MANAGER — exactly ROLE_MENU_ASSIGNMENTS'
 * `ai-assistant` rows. A role that already has a row for the group keeps it.
 * A per-user override (`user_menu_permissions`) granting `sop` to one user is
 * not followed: that user can call the API but sees no entry until an admin
 * grants it.
 *
 * On a database that has NOT been seeded (no `home` menu group), this does
 * nothing: the seed creates the group and the grants itself.
 *
 * Cache note (as 0021/0025/0027): `getRolePermissionsMatrix` caches each
 * role's matrix in Redis for up to an hour. Flush `<prefix>permissions:*` after
 * this runs, or the sidebar keeps the old menu until the keys expire.
 *
 * No try/catch: a failure must fail the migration, not be recorded as applied
 * (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   SELECT r.name, p.permission_type
 *     FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id
 *     JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug = 'ai-assistant' ORDER BY r.name;
 */

const SLUG = "ai-assistant";
const FIXED_ID = "a0000000-0000-0000-0000-000000000234";
const PARENT_SLUG = "mgmt-quality";

/** Grants that let a role call POST /ai/query (`sop` read, directly or by cascade). */
const SOP_SLUGS = ["sop", "mgmt-quality"];
/** Grants that let a role call POST /ai/ocr (`certificate` write, directly or by cascade). */
const CERTIFICATE_WRITE_SLUGS = ["certificate", "equipment"];

/** Rows of a one-column query, as plain values. */
const column = async (queryInterface, sql, replacements, key) => {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows.map((row) => row[key]);
};

module.exports = {
  SLUG,
  FIXED_ID,
  SOP_SLUGS,
  CERTIFICATE_WRITE_SLUGS,

  async up({ context }) {
    const queryInterface = context.queryInterface || context;

    const seeded = await column(
      queryInterface,
      "SELECT id FROM menu_groups WHERE slug = 'home'",
      [],
      "id",
    );
    if (seeded.length === 0) {
      return; // not seeded yet — the seed creates the group and its grants
    }

    const existing = await column(
      queryInterface,
      "SELECT id FROM menu_groups WHERE slug = ?",
      [SLUG],
      "id",
    );

    if (existing.length === 0) {
      const idTaken = await column(
        queryInterface,
        "SELECT id FROM menu_groups WHERE id = ?",
        [FIXED_ID],
        "id",
      );
      const parent = await column(
        queryInterface,
        "SELECT id FROM menu_groups WHERE slug = ?",
        [PARENT_SLUG],
        "id",
      );

      await queryInterface.sequelize.query(
        `INSERT INTO menu_groups
                (id, name, slug, icon, parent_id, sort_order, is_active, created_at, updated_at)
         VALUES (${idTaken.length === 0 ? "?" : "gen_random_uuid()"},
                 'AI Assistant', ?, 'Sparkles', ?, 6, true, NOW(), NOW())`,
        {
          replacements: [
            ...(idTaken.length === 0 ? [FIXED_ID] : []),
            SLUG,
            parent.length > 0 ? parent[0] : null,
          ],
        },
      );
    }

    await queryInterface.sequelize.query(
      `INSERT INTO role_menu_permissions
              (id, role_id, menu_group_id, permission_type, created_at, updated_at)
       SELECT gen_random_uuid(), r.id, m.id, 'read', NOW(), NOW()
         FROM roles r
        CROSS JOIN menu_groups m
        WHERE m.slug = ?
          AND EXISTS (
                SELECT 1
                  FROM role_menu_permissions g
                  JOIN menu_groups gm ON gm.id = g.menu_group_id
                 WHERE g.role_id = r.id
                   AND (gm.slug IN (?)
                        OR (gm.slug IN (?) AND g.permission_type = 'write'))
              )
          AND NOT EXISTS (
                SELECT 1 FROM role_menu_permissions x
                 WHERE x.role_id = r.id AND x.menu_group_id = m.id
              )`,
      { replacements: [SLUG, SOP_SLUGS, CERTIFICATE_WRITE_SLUGS] },
    );
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;

    // Back to the state before A-118: no `ai-assistant` group. Its grants
    // (role and per-user) go with it — deleted explicitly rather than relying
    // on the foreign keys' ON DELETE CASCADE. A grant an administrator added
    // by hand is lost on rollback; accepted, the group itself is gone.
    await queryInterface.sequelize.query(
      `DELETE FROM role_menu_permissions p
         USING menu_groups m
        WHERE p.menu_group_id = m.id AND m.slug = ?`,
      { replacements: [SLUG] },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM user_menu_permissions p
         USING menu_groups m
        WHERE p.menu_group_id = m.id AND m.slug = ?`,
      { replacements: [SLUG] },
    );
    await queryInterface.sequelize.query("DELETE FROM menu_groups WHERE slug = ?", {
      replacements: [SLUG],
    });
  },
};
