/**
 * Migration 0098 — the tenant administrator manages its own tenant's IP
 * allowlist and geofence (Q-38, ADR-100).
 *
 * `PUT /network-security/ip-allowlist` and `/geofence` were `superAdminOnly`.
 * ADR-100 decides that a tenant administrator MAY set them for its own tenant
 * (`network-security: write`), behind a self-lockout guard (a change that
 * would refuse the caller's own next sign-in is 409). ROLE_MENU_ASSIGNMENTS
 * now seeds HEALTHCARE ADMIN with `write`; this raises the existing `read`
 * grant on a database seeded before, and creates the grant where the role has
 * none. A role an operator set by hand to `write` is untouched; a tenant's own
 * roles are untouched (the list is frozen by name).
 *
 * No try/catch: a failure propagates and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   SELECT r.name, p.permission_type FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug = 'network-security';
 *
 * Idempotent + reversible (down returns HEALTHCARE ADMIN to `read`).
 */
import type { QueryInterface } from "sequelize";

const SLUG = "network-security";
/** Frozen 2026-09-29: the seeded roles ROLE_MENU_ASSIGNMENTS raised to `write` by Q-38. */
const ROLE_NAMES_TO_GRANT: readonly string[] = Object.freeze(["HEALTHCARE ADMIN"]);

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  // Existing `read` rows are raised to `write`.
  await context.sequelize.query(
    `UPDATE role_menu_permissions p
        SET permission_type = 'write', updated_at = NOW()
       FROM roles r, menu_groups m
      WHERE p.role_id = r.id
        AND p.menu_group_id = m.id
        AND m.slug = :slug
        AND r.name IN (:roles)
        AND p.permission_type <> 'write'`,
    { replacements: { slug: SLUG, roles: [...ROLE_NAMES_TO_GRANT] } },
  );
  // A role with no row gets one.
  await context.sequelize.query(
    `INSERT INTO role_menu_permissions
            (id, role_id, menu_group_id, permission_type, created_at, updated_at)
     SELECT gen_random_uuid(), r.id, m.id, 'write', NOW(), NOW()
       FROM roles r
      CROSS JOIN menu_groups m
      WHERE m.slug = :slug
        AND r.name IN (:roles)
        AND NOT EXISTS (
              SELECT 1 FROM role_menu_permissions x
               WHERE x.role_id = r.id AND x.menu_group_id = m.id
            )`,
    { replacements: { slug: SLUG, roles: [...ROLE_NAMES_TO_GRANT] } },
  );
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query(
    `UPDATE role_menu_permissions p
        SET permission_type = 'read', updated_at = NOW()
       FROM roles r, menu_groups m
      WHERE p.role_id = r.id
        AND p.menu_group_id = m.id
        AND m.slug = :slug
        AND r.name IN (:roles)`,
    { replacements: { slug: SLUG, roles: [...ROLE_NAMES_TO_GRANT] } },
  );
};

export = { SLUG, ROLE_NAMES_TO_GRANT, up, down };
