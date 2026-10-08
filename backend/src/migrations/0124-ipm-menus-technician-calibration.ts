/**
 * Migration 0124 — P20-06: the `ipm`, `ipm-templates` and `client-facilities`
 * menu entries, their default grants, and UD-4 (b): `calibration` write for
 * TECHNICIAN and HEALTHCARE TECHNICIAN (spec MEMORY/specs/P18-01-02 § 3.1, § 4.2;
 * P18-03 § 7; ADR-124 Am. 5).
 *
 * The seed (`seedMenuGroups.util.ts`, `ROLE_MENU_ASSIGNMENTS`) creates all of it
 * on a database seeded from now on; this does the same for an already-seeded
 * one (the 0020/0021/0025/0038 trap: the seed never updates an existing
 * database). On a database that has NOT been seeded (no `home` menu group),
 * this does nothing: the seed creates the groups and the grants itself.
 *
 * Three idempotent steps:
 *  1. the three menu groups by slug, under their parents, INACTIVE until their
 *     pages ship (ADR-124 Am. 5 § 2 — the gates read a grant whatever the flag);
 *     a slug that exists is left alone;
 *  2. the explicit grants of § 3.1 by role NAME and menu SLUG; an existing pair
 *     is skipped, never downgraded;
 *  3. `calibration` write for the two technician roles: an existing `read` row
 *     is raised, an absent one inserted. Roles and their grants are global
 *     (ADR-064), so this changes every tenant at once; per-user overrides
 *     (`user_menu_permissions`) are never touched — an override still replaces
 *     the role grant (ADR-102).
 *
 * `down` removes the three groups with their role and user grants; it leaves
 * the technicians' `calibration` write in place (spec § 4.2: a grant revert is a
 * data decision, not a schema one — the prior state had no row at all).
 *
 * Cache note (as 0038/0101/0116): flush `<prefix>permissions:*` after this runs,
 * or a role's matrix stays cached for up to an hour.
 *
 * No try/catch: a failure fails the migration (CLAUDE.md). Verify with psql:
 *   SELECT m.slug, m.is_active, r.name, p.permission_type
 *     FROM menu_groups m
 *     LEFT JOIN role_menu_permissions p ON p.menu_group_id = m.id
 *     LEFT JOIN roles r ON r.id = p.role_id
 *    WHERE m.slug IN ('ipm', 'ipm-templates', 'client-facilities', 'calibration')
 *    ORDER BY 1, 3;
 */
import type { QueryInterface } from "sequelize";

interface MenuEntry {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly parentSlug: string;
  readonly sortOrder: number;
  readonly fixedId: string;
}

/** Frozen 2026-10-08 — as `seedMenuGroups.util.ts` seeds them. */
const MENUS: readonly MenuEntry[] = Object.freeze([
  { slug: "ipm", name: "IPM", icon: "ClipboardCheck", parentSlug: "equipment", sortOrder: 6, fixedId: "a0000000-0000-0000-0000-000000000307" },
  { slug: "ipm-templates", name: "IPM Checklists", icon: "ClipboardList", parentSlug: "equipment", sortOrder: 7, fixedId: "a0000000-0000-0000-0000-000000000308" },
  { slug: "client-facilities", name: "Client Facilities", icon: "Building2", parentSlug: "mgmt-organization", sortOrder: 9, fixedId: "a0000000-0000-0000-0000-000000000240" },
]);

/** Frozen 2026-10-08 — the explicit rows of spec P18-01-02 § 3.1 on the new slugs. */
const GRANTS: readonly (readonly [role: string, slug: string, permission: "read" | "write"])[] = Object.freeze([
  ["SUPERADMIN", "ipm", "write"],
  ["SUPERADMIN", "ipm-templates", "write"],
  ["SUPERADMIN", "client-facilities", "write"],
  ["HEALTHCARE ADMIN", "client-facilities", "write"],
  ["CALIBRATOR ADMIN", "client-facilities", "write"],
  ["ENGINEERING MANAGER", "client-facilities", "read"],
  ["TECHNICIAN", "ipm", "write"],
  ["HEALTHCARE TECHNICIAN", "ipm", "write"],
  ["FACILITY MAINTENANCE", "ipm", "write"],
]);

/** UD-4 (b), working decision 2026-10-08: the roles raised to `calibration` write. */
const CALIBRATION_WRITERS: readonly string[] = Object.freeze(["TECHNICIAN", "HEALTHCARE TECHNICIAN"]);
const CALIBRATION_SLUG = "calibration";

const ids = async (context: QueryInterface, sql: string, bind: readonly string[] = []): Promise<string[]> => {
  const [rows] = (await context.sequelize.query(sql, { bind: [...bind] })) as [{ id: string }[], unknown];
  return rows.map((row) => row.id);
};

const createMenu = async (context: QueryInterface, menu: MenuEntry): Promise<void> => {
  if ((await ids(context, "SELECT id FROM menu_groups WHERE slug = $1", [menu.slug])).length > 0) {
    return;
  }
  const idTaken = (await ids(context, "SELECT id FROM menu_groups WHERE id = $1", [menu.fixedId])).length > 0;
  const parent = (await ids(context, "SELECT id FROM menu_groups WHERE slug = $1", [menu.parentSlug]))[0] ?? null;
  await context.sequelize.query(
    `INSERT INTO menu_groups (id, name, slug, icon, parent_id, sort_order, is_active, created_at, updated_at)
     VALUES (${idTaken ? "gen_random_uuid()" : "$6::uuid"}, $1, $2, $3, $4::uuid, $5, false, NOW(), NOW())`,
    { bind: idTaken ? [menu.name, menu.slug, menu.icon, parent, menu.sortOrder] : [menu.name, menu.slug, menu.icon, parent, menu.sortOrder, menu.fixedId] },
  );
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  if ((await ids(context, "SELECT id FROM menu_groups WHERE slug = 'home'")).length === 0) {
    return; // not seeded yet — the seed creates the groups and the grants
  }
  for (const menu of MENUS) {
    await createMenu(context, menu);
  }
  // Step 2: the explicit grants; an existing pair is skipped (never downgraded).
  await context.sequelize.query(
    `INSERT INTO role_menu_permissions (id, role_id, menu_group_id, permission_type, created_at, updated_at)
     SELECT gen_random_uuid(), r.id, m.id, g.permission, NOW(), NOW()
       FROM unnest($1::text[], $2::text[], $3::text[]) AS g(role_name, slug, permission)
       JOIN roles r ON r.name = g.role_name
       JOIN menu_groups m ON m.slug = g.slug
      WHERE NOT EXISTS (SELECT 1 FROM role_menu_permissions x WHERE x.role_id = r.id AND x.menu_group_id = m.id)`,
    { bind: [GRANTS.map((g) => g[0]), GRANTS.map((g) => g[1]), GRANTS.map((g) => g[2])] },
  );
  // Step 3: UD-4 (b) — raise an existing row, then insert where the role has none.
  await context.sequelize.query(
    `UPDATE role_menu_permissions p
        SET permission_type = 'write', updated_at = NOW()
       FROM roles r, menu_groups m
      WHERE p.role_id = r.id AND p.menu_group_id = m.id
        AND m.slug = $1 AND r.name = ANY($2::text[])
        AND p.permission_type <> 'write'`,
    { bind: [CALIBRATION_SLUG, [...CALIBRATION_WRITERS]] },
  );
  await context.sequelize.query(
    `INSERT INTO role_menu_permissions (id, role_id, menu_group_id, permission_type, created_at, updated_at)
     SELECT gen_random_uuid(), r.id, m.id, 'write', NOW(), NOW()
       FROM roles r CROSS JOIN menu_groups m
      WHERE m.slug = $1 AND r.name = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM role_menu_permissions x WHERE x.role_id = r.id AND x.menu_group_id = m.id)`,
    { bind: [CALIBRATION_SLUG, [...CALIBRATION_WRITERS]] },
  );
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const slugs = MENUS.map((m) => m.slug);
  await context.sequelize.query(
    "DELETE FROM role_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug = ANY($1::text[])",
    { bind: [slugs] },
  );
  await context.sequelize.query(
    "DELETE FROM user_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug = ANY($1::text[])",
    { bind: [slugs] },
  );
  await context.sequelize.query("DELETE FROM menu_groups WHERE slug = ANY($1::text[])", { bind: [slugs] });
};

export = { MENUS, GRANTS, CALIBRATION_WRITERS, CALIBRATION_SLUG, up, down };
