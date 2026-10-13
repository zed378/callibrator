/**
 * Migration 0142 — UAT gap C-3: the calibration-dates page (`/dashboard/calibration-dates`, P22-05)
 * and the exports page (`/dashboard/exports`, P22-07) shipped without a menu entry. Both are reached
 * through the `calibration` read gate (the calibration-record routes, the device register); this
 * adds their entries, `calibration-dates` and `exports`, under Equipment, ACTIVE (the pages exist),
 * and grants them `read` to every role that already reaches those pages: a role holding a row on
 * `calibration`, or on `equipment` (whose grant cascades to its children —
 * roles.service#getRolePermissionsMatrix). The sidebar shows an entry only when its page's gate
 * passes too (constants/menuPageAccess: `menu("calibration")`), and a bound user's ceiling admits
 * both at read (constants/facilityAccess SHARED_CEILING). The writes stay `calibration`'s: the
 * entry tab of the calibration-dates page asks `calibration` write, not this entry.
 *
 * The seed (`seedMenuGroups.util.ts`, `ROLE_MENU_ASSIGNMENTS`) creates the same on a database seeded
 * from now on; this does it for an already-seeded one. On a database that has NOT been seeded (no
 * `home` group) this does nothing: the seed creates the groups and the grants itself. The shape is
 * 0124's (by slug, a fixed id when free, the parent by slug; an existing pair is skipped, never
 * downgraded).
 *
 * Idempotent: a second run changes nothing. `down` removes the two groups with their role and user
 * grants. No try/catch: a failure fails the migration (CLAUDE.md). Verify with psql:
 *   SELECT m.slug, m.is_active, r.name, p.permission_type FROM menu_groups m
 *     LEFT JOIN role_menu_permissions p ON p.menu_group_id = m.id LEFT JOIN roles r ON r.id = p.role_id
 *    WHERE m.slug IN ('calibration-dates', 'exports') ORDER BY 1, 3;
 * Cache note (as 0124): flush `<prefix>permissions:*` / `<prefix>menu*` after this runs, or wait for the TTL.
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

/** Frozen 2026-10-13 — as `seedMenuGroups.util.ts` seeds them. */
const MENUS: readonly MenuEntry[] = Object.freeze([
  { slug: "calibration-dates", name: "Calibration Dates", icon: "Gauge", parentSlug: "equipment", sortOrder: 8, fixedId: "a0000000-0000-0000-0000-000000000309" },
  { slug: "exports", name: "Exports", icon: "Table2", parentSlug: "equipment", sortOrder: 9, fixedId: "a0000000-0000-0000-0000-000000000310" },
]);

/** The menus whose holders already reach both pages (`calibration` read, directly or by cascade). */
const REACHING_SLUGS: readonly string[] = Object.freeze(["calibration", "equipment"]);

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
     VALUES (${idTaken ? "gen_random_uuid()" : "$6::uuid"}, $1, $2, $3, $4::uuid, $5, true, NOW(), NOW())`,
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
  // `read` for every role holding a row on a reaching menu; an existing pair is skipped (never downgraded).
  await context.sequelize.query(
    `INSERT INTO role_menu_permissions (id, role_id, menu_group_id, permission_type, created_at, updated_at)
     SELECT gen_random_uuid(), h.role_id, m.id, 'read', NOW(), NOW()
       FROM (SELECT DISTINCT p.role_id FROM role_menu_permissions p JOIN menu_groups r ON r.id = p.menu_group_id WHERE r.slug = ANY($2::text[])) h
      CROSS JOIN menu_groups m
      WHERE m.slug = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM role_menu_permissions x WHERE x.role_id = h.role_id AND x.menu_group_id = m.id)`,
    { bind: [MENUS.map((m) => m.slug), [...REACHING_SLUGS]] },
  );
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const slugs = MENUS.map((m) => m.slug);
  await context.sequelize.query("DELETE FROM role_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug = ANY($1::text[])", {
    bind: [slugs],
  });
  await context.sequelize.query("DELETE FROM user_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug = ANY($1::text[])", {
    bind: [slugs],
  });
  await context.sequelize.query("DELETE FROM menu_groups WHERE slug = ANY($1::text[])", { bind: [slugs] });
};

export = { MENUS, REACHING_SLUGS, up, down };
