"use strict";

/**
 * The `esignature` menu group and its grants (A-84).
 *
 * `POST /esignature/sign`, `POST /esignature/verify` and `GET
 * /esignature/history` carried no permission gate. They are now gated on
 * `dynamicAccess(MENU_SLUGS.ESIGNATURE, …)`, and `dynamicAccess` finds a grant
 * only in `role_menu_permissions`. The seed (`seedMenuGroups.util.js`,
 * `ROLE_MENU_ASSIGNMENTS`) creates the group and the grants for a database
 * seeded from now on — but seeding creates missing rows and nothing else, and
 * no seeded database has an `esignature` group at all. Without this migration
 * every non-SUPERADMIN signer in every existing deployment would get 403 on
 * `/sign` the moment the gate shipped: the silent-lockout shape of A-58.
 *
 * What it does, on a database that has been seeded:
 *  1. creates the `esignature` menu group under `mgmt-quality` (top level if
 *     that category is absent), with the seed's fixed id when it is free;
 *  2. grants `write` on it to every seeded role, exactly as
 *     ROLE_MENU_ASSIGNMENTS does. A role that already has a row for the group
 *     keeps it — this never overwrites a grant somebody set by hand.
 *
 * WHY EVERY ROLE. A workflow step can name any user in the tenant as its
 * signer, and signDocument refuses anyone but that signer (A-65). A role left
 * out here would make every workflow naming one of its users uncompletable.
 * The gate's value is that a tenant can now withdraw signing from a role or a
 * user, and that API keys need an explicit `esignature:*` scope.
 *
 * On a database that has NOT been seeded (no `home` menu group — a fresh
 * install, where db.sync() has just created empty tables), this does nothing:
 * the seed will create the group and the grants itself.
 *
 * The role list is frozen here rather than read from the constants, so what
 * this migration did cannot change after it has been recorded as applied.
 * `tests/migrations/0025-esignature-menu-grants.test.js` asserts it matched
 * ROLE_MENU_ASSIGNMENTS when it was written.
 *
 * Cache note (as 0021): `getRolePermissionsMatrix` caches each role's matrix in
 * Redis for up to an hour under `cacheKeys.permissions(roleId)`. Flush those
 * keys after this runs, or signers keep the old matrix — and a 403 on /sign —
 * until they expire:  redis-cli --scan --pattern '<prefix>permissions:*' | xargs redis-cli del
 *
 * No try/catch: a failure must fail the migration, not be recorded as applied
 * (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   SELECT r.name, p.permission_type
 *     FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id
 *     JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug = 'esignature' ORDER BY r.name;
 */

const SLUG = "esignature";
const FIXED_ID = "a0000000-0000-0000-0000-000000000233";
const PARENT_SLUG = "mgmt-quality";

/** Every seeded role, as ROLE_MENU_ASSIGNMENTS stood on 2026-09-24. */
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

/** Rows of a one-column query, as plain values. */
const column = async (queryInterface, sql, replacements, key) => {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows.map((row) => row[key]);
};

module.exports = {
  SLUG,
  FIXED_ID,
  GRANTED_ROLES,

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
                 'E-Signatures', ?, 'ClipboardCheck', ?, 5, true, NOW(), NOW())`,
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

    // Back to the state before A-84, where no `esignature` group existed. The
    // grants (role and per-user) go with the group: both foreign keys are
    // ON DELETE CASCADE, and they are deleted explicitly as well so the
    // reversal does not depend on that.
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
