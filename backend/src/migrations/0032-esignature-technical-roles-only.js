"use strict";

/**
 * Withdraw the DEFAULT `esignature` grant from USER, ROOM USER and WAREHOUSE
 * STAFF (A-129, ADR-051 Q-19).
 *
 * Migration 0025 (A-84) gave `esignature: write` to every seeded role, on the
 * reasoning that a role left out would make any workflow naming one of its
 * users uncompletable. ADR-051 Q-19 decided signing is for the technical roles
 * only, and A-129 moved the "uncompletable workflow" check to workflow
 * creation: a signer without `esignature: write` is refused there, so no new
 * workflow can be stranded by this migration.
 *
 * WHAT IT REMOVES — only a grant that is still the untouched default:
 *   - the role is one of REVOKED_ROLES and the row is on the `esignature` group;
 *   - `permission_type = 'write'` (what 0025 and the seed wrote);
 *   - `created_at = updated_at` — the row was never updated. Both 0025
 *     (`NOW()` twice in one statement) and the seed (one timestamp for both
 *     columns) write them equal; `roles.service#assignMenuToRole` updating the
 *     row moves `updated_at`;
 *   - NO audit row records an administrator granting or revoking this group on
 *     this role (`resource_type = 'Role'`, `resource_id` = the role,
 *     `changes->>'menuGroupId'` = the group — the shape
 *     `roles.service#assignMenuToRole` / `removeMenuFromRole` write). A tenant
 *     admin who re-granted `write` deliberately keeps it, even though the row
 *     looks like the default.
 * Anything else — a `read` row, a row that was updated, a row an admin touched
 * — is KEPT and reported (console.warn) for a tenant admin to review. Per-user
 * grants (`user_menu_permissions`) are never touched: every one of them was set
 * by hand.
 *
 * It also REPORTS, and changes nothing about, open workflow steps whose signer
 * holds one of these roles: those workflows may now be unsignable. They are
 * listed so the tenant can cancel them (POST /esignature/workflows/:id/cancel)
 * or grant the signer the permission — not cancelled here.
 *
 * On a database without the `esignature` group (not seeded yet) this does
 * nothing: the seed now writes the new defaults itself.
 *
 * The role list is frozen here rather than read from the constants, so what
 * this migration did cannot change after it has been recorded as applied.
 * `tests/migrations/0032-esignature-technical-roles-only.test.js` asserts it
 * matched ROLE_MENU_ASSIGNMENTS when it was written.
 *
 * `down` gives `write` back to each of these roles that has no row for the
 * group, as 0025 did (NOT EXISTS). It cannot tell a grant this migration
 * removed from one an administrator removed after it ran, so a rollback may
 * restore a grant a tenant admin had withdrawn. Accepted: a rollback returns to
 * the pre-A-129 default, in which every seeded role could sign.
 *
 * Cache note (as 0021/0025/0027): `getRolePermissionsMatrix` caches each
 * role's matrix in Redis for up to an hour under `cacheKeys.permissions(roleId)`.
 * Flush those keys after this runs, or USER / ROOM USER / WAREHOUSE STAFF keep
 * signing until they expire:
 *   redis-cli --scan --pattern '<prefix>permissions:*' | xargs redis-cli del
 *
 * No try/catch: a failure must fail the migration, not be recorded as applied
 * (CLAUDE.md; 0008/0013/0014). Verify with psql, not the log:
 *   SELECT r.name, p.permission_type, p.created_at = p.updated_at AS untouched
 *     FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id
 *     JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug = 'esignature' ORDER BY r.name;
 */

const SLUG = "esignature";

/** The roles ADR-051 Q-19 takes signing from, as of 2026-09-24. */
const REVOKED_ROLES = ["USER", "ROOM USER", "WAREHOUSE STAFF"];

/**
 * The predicate for "an untouched default grant", shared by the report and the
 * DELETE so the two cannot disagree. `p`, `r` and `m` are the grant, its role
 * and its menu group.
 */
const UNTOUCHED_DEFAULT = `
      p.permission_type = 'write'
  AND p.created_at = p.updated_at
  AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
         WHERE a.resource_type = 'Role'
           AND a.resource_id = r.id::text
           AND a.changes->>'menuGroupId' = m.id::text
      )`;

module.exports = {
  SLUG,
  REVOKED_ROLES,
  UNTOUCHED_DEFAULT,

  async up({ context }) {
    const queryInterface = context.queryInterface || context;
    const { sequelize } = queryInterface;

    const [groups] = await sequelize.query("SELECT id FROM menu_groups WHERE slug = ?", {
      replacements: [SLUG],
    });
    if (groups.length === 0) {
      return; // not seeded yet — the seed writes the new defaults
    }

    await sequelize.query(
      `DELETE FROM role_menu_permissions p
        USING roles r, menu_groups m
        WHERE p.role_id = r.id
          AND p.menu_group_id = m.id
          AND m.slug = ?
          AND r.name IN (?)
          AND ${UNTOUCHED_DEFAULT}`,
      { replacements: [SLUG, REVOKED_ROLES] },
    );

    // What was left, for a tenant admin to review.
    const [kept] = await sequelize.query(
      `SELECT r.name AS role, p.permission_type AS permission
         FROM role_menu_permissions p
         JOIN roles r ON r.id = p.role_id
         JOIN menu_groups m ON m.id = p.menu_group_id
        WHERE m.slug = ? AND r.name IN (?)
        ORDER BY r.name`,
      { replacements: [SLUG, REVOKED_ROLES] },
    );
    for (const row of kept) {
      console.warn(
        `0032: kept the "${row.permission}" esignature grant of role "${row.role}": it is not the ` +
          "untouched default (an administrator set or changed it). Review it against ADR-051 Q-19.",
      );
    }

    // Open steps whose signer's role no longer signs by default. Reported only.
    const [stranded] = await sequelize.query(
      `SELECT s.tenant_id, s.workflow_id, s.step_number, r.name AS role
         FROM signature_workflow_steps s
         JOIN signature_workflows w ON w.id = s.workflow_id
         JOIN users u ON u.id = s.signer_id
         JOIN roles r ON r.id = u.role_id
        WHERE s.status IN ('pending', 'waiting')
          AND s.deleted_at IS NULL
          AND w.deleted_at IS NULL
          AND w.status NOT IN ('completed', 'cancelled')
          AND r.name IN (?)
        ORDER BY s.tenant_id, s.workflow_id, s.step_number`,
      { replacements: [REVOKED_ROLES] },
    );
    for (const row of stranded) {
      console.warn(
        `0032: workflow ${row.workflow_id} (tenant ${row.tenant_id}) step ${row.step_number} names a ` +
          `"${row.role}" signer, who may no longer be able to sign. Cancel the workflow or grant the ` +
          "signer esignature write.",
      );
    }
  },

  async down({ context }) {
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
      { replacements: [SLUG, REVOKED_ROLES] },
    );
  },
};
