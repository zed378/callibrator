/**
 * Give both tenant-admin roles `write` on the `metered-billing` menu (ADR-043).
 *
 * `meteredBilling.route.js` moved from `rbac(["TENANT_ADMIN","BILLING_ADMIN"])`
 * — a gate no principal could ever clear — to
 * `dynamicAccess("metered-billing", read|write)`. The grant matrix it now reads
 * had the same defect from the other end: `HEALTHCARE ADMIN` held only `read`
 * and `CALIBRATOR ADMIN` had no row at all, so the conversion would have
 * replaced one silent lockout with another.
 *
 * `ROLE_MENU_ASSIGNMENTS` in `constants/roleConstants.js` now says `write` for
 * both, but `seedRoleMenuPermissions` only CREATES missing rows and never
 * updates an existing one (`migration.service.js`), so the constant edit alone
 * changes nothing in any database that has already been seeded — the same
 * seed-skips-existing trap that made migration 0020 necessary.
 *
 * Cache note: `getRolePermissionsMatrix` caches the matrix per role in Redis
 * under `cacheKeys.permissions(roleId)`. Flush that key (or let it expire) after
 * running this, or the two admin roles keep the old matrix until it does.
 *
 * No blanket try/catch — if the tables are not there, this must fail loudly
 * rather than be recorded as applied. Verify:
 *   SELECT r.name, m.slug, p.permission_type
 *     FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id
 *     JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug = 'metered-billing';
 */
const SLUG = "metered-billing";
const ROLE_NAMES_TO_GRANT = ["HEALTHCARE ADMIN", "CALIBRATOR ADMIN"];

module.exports = {
  async up({ context }) {
    const queryInterface = context.queryInterface || context;

    // Existing rows (HEALTHCARE ADMIN's `read`) are raised to `write`.
    await queryInterface.sequelize.query(
      `UPDATE role_menu_permissions p
          SET permission_type = 'write', updated_at = NOW()
         FROM roles r, menu_groups m
        WHERE p.role_id = r.id
          AND p.menu_group_id = m.id
          AND m.slug = ?
          AND r.name IN (?)
          AND p.permission_type <> 'write'`,
      { replacements: [SLUG, ROLE_NAMES_TO_GRANT] },
    );

    // Missing rows (CALIBRATOR ADMIN has none) are created.
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
      { replacements: [SLUG, ROLE_NAMES_TO_GRANT] },
    );
  },

  async down({ context }) {
    const queryInterface = context.queryInterface || context;

    // Exact reverse of `up`: HEALTHCARE ADMIN goes back to `read`, and
    // CALIBRATOR ADMIN — which had no row before — loses the one this created.
    await queryInterface.sequelize.query(
      `UPDATE role_menu_permissions p
          SET permission_type = 'read', updated_at = NOW()
         FROM roles r, menu_groups m
        WHERE p.role_id = r.id
          AND p.menu_group_id = m.id
          AND m.slug = ?
          AND r.name = ?`,
      { replacements: [SLUG, "HEALTHCARE ADMIN"] },
    );

    await queryInterface.sequelize.query(
      `DELETE FROM role_menu_permissions p
         USING roles r, menu_groups m
        WHERE p.role_id = r.id
          AND p.menu_group_id = m.id
          AND m.slug = ?
          AND r.name = ?`,
      { replacements: [SLUG, "CALIBRATOR ADMIN"] },
    );
  },
};
