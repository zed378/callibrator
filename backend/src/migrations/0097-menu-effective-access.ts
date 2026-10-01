/**
 * The menu follows the effective API permission (ADR-102): the Stock and
 * Object Storage entries, and the grants that keep every page a role could
 * use visible once the sidebar stops cascading.
 *
 * WHAT WAS WRONG
 *
 *  - /dashboard/stock (the whole inventory module) and /dashboard/storage had
 *    no menu entry: reachable only by a search result or a typed URL.
 *  - The sidebar showed a node when any ANCESTOR was granted, the API a node
 *    or its PARENT only. menuGroup.service#getRoleMenuAssignments now shows
 *    what the API serves (services/effectivePermission), so the pages two
 *    levels below a `management` grant that the API serves through a gate
 *    OTHER than their own grant would vanish for the roles using them. Those
 *    are granted here by slug, with the role's `management` permission type —
 *    and only when the page's API gate passes for the role, so no grant here
 *    lets anyone call anything they could not before:
 *      tenants          — API gate `management` read (tenant.route.js)
 *      tenant-hierarchy — no menu gate (GET /tenant-hierarchy/tree is `auth`)
 *      kanban           — no menu gate (board membership, kanban.service)
 *      api-keys,        — rbac TENANT_ADMIN: role_level >= 8
 *      webhooks
 *      attachments      — API gate `equipment` read: a grant on `equipment`
 *    None of these slugs is a `dynamicAccess` gate anywhere
 *    (menuEffectiveAccess0097.adr102.test.ts reads the route files).
 *    The super admin is skipped: it passes every gate without a grant.
 *
 * WHAT THIS DOES (only on a seeded database — a `home` menu group exists)
 *
 *  1. creates `stock` (top level, after Warehouse) and `storage` (Management ›
 *     Content), each with its fixed seed id unless the id is taken;
 *  2. grants `stock` to every role holding `warehouse`, with the same type
 *     (its API is `warehouse`-gated; constants/menuPageAccess);
 *  3. grants `storage` write to every role with role_level >= 8 (its API is
 *     rbac TENANT_ADMIN);
 *  4. the grants listed above.
 * A role that already has a row for a menu keeps it. These are the rows
 * ROLE_MENU_ASSIGNMENTS gives a database seeded from now on.
 *
 * Cache note (as 0021/0025/0038): roles.service#getRolePermissionsMatrix
 * caches each role's matrix in Redis for up to an hour. Flush
 * `<prefix>permissions:*` after this runs, or the sidebar keeps the old menu.
 *
 * No try/catch: a failure propagates and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   SELECT slug, parent_id FROM menu_groups WHERE slug IN ('stock', 'storage');
 *   SELECT r.name, m.slug, p.permission_type FROM role_menu_permissions p
 *     JOIN roles r ON r.id = p.role_id JOIN menu_groups m ON m.id = p.menu_group_id
 *    WHERE m.slug IN ('stock','storage','tenants','tenant-hierarchy','kanban','api-keys','webhooks','attachments')
 *    ORDER BY m.slug, r.name;
 *
 * Idempotent. `down` removes the two menu groups and their grants (role and
 * per-user); the step-4 grants stay, since they cannot be told from grants
 * an administrator made — they grant no API access (see above).
 */
import type { QueryInterface } from "sequelize";

interface NewMenu {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly fixedId: string;
  readonly parentSlug: string | null;
  readonly sortOrder: number;
}

const NEW_MENUS: readonly NewMenu[] = Object.freeze([
  { slug: "stock", name: "Stock", icon: "Package", fixedId: "a0000000-0000-0000-0000-000000000235", parentSlug: null, sortOrder: 7 },
  {
    slug: "storage",
    name: "Object Storage",
    icon: "HardDrive",
    fixedId: "a0000000-0000-0000-0000-000000000236",
    parentSlug: "mgmt-content",
    sortOrder: 2,
  },
]);

/** The level rbac([TENANT_ADMIN]) requires (constants/roleConstants ROLE_LEVELS.TENANT_ADMIN). */
const TENANT_ADMIN_LEVEL = 8;
/** The same, as SQL text (a constant, never input). */
const TENANT_ADMIN_LEVEL_SQL = String(TENANT_ADMIN_LEVEL);

/**
 * Step 4: slug → the extra SQL condition on role `r` for the page's API gate
 * to pass (besides the role holding `management`). `TRUE` = no menu gate.
 */
const MANAGEMENT_PAGE_GRANTS: Readonly<Record<string, string>> = Object.freeze({
  tenants: "TRUE",
  "tenant-hierarchy": "TRUE",
  kanban: "TRUE",
  "api-keys": `COALESCE(r.role_level, 0) >= ${TENANT_ADMIN_LEVEL_SQL}`,
  webhooks: `COALESCE(r.role_level, 0) >= ${TENANT_ADMIN_LEVEL_SQL}`,
  attachments: `EXISTS (SELECT 1 FROM role_menu_permissions e JOIN menu_groups em ON em.id = e.menu_group_id
                         WHERE e.role_id = r.id AND em.slug = 'equipment')`,
});

type Row = Record<string, unknown>;

const select = async (context: QueryInterface, sql: string, replacements: unknown[] = []): Promise<Row[]> => {
  const [rows] = (await context.sequelize.query(sql, { replacements })) as [Row[], unknown];
  return rows;
};

const ensureMenu = async (context: QueryInterface, menu: NewMenu): Promise<void> => {
  const existing = await select(context, "SELECT id FROM menu_groups WHERE slug = ?", [menu.slug]);
  if (existing.length > 0) {
    return;
  }
  const idTaken = (await select(context, "SELECT id FROM menu_groups WHERE id = ?", [menu.fixedId])).length > 0;
  const parent = menu.parentSlug
    ? await select(context, "SELECT id FROM menu_groups WHERE slug = ?", [menu.parentSlug])
    : [];
  const parentRow = parent[0];
  const parentId = parentRow ? parentRow["id"] : null;
  await context.sequelize.query(
    `INSERT INTO menu_groups (id, name, slug, icon, parent_id, sort_order, is_active, created_at, updated_at)
     VALUES (${idTaken ? "gen_random_uuid()" : "?"}, ?, ?, ?, ?, ?, true, NOW(), NOW())`,
    {
      replacements: [
        ...(idTaken ? [] : [menu.fixedId]),
        menu.name,
        menu.slug,
        menu.icon,
        parentId,
        menu.sortOrder,
      ],
    },
  );
};

/** Insert `slug` grants for the roles `roleSql` selects (columns: role_id, permission_type), skipping existing rows. */
const grant = async (context: QueryInterface, slug: string, roleSql: string): Promise<void> => {
  await context.sequelize.query(
    `INSERT INTO role_menu_permissions (id, role_id, menu_group_id, permission_type, created_at, updated_at)
     SELECT gen_random_uuid(), g.role_id, m.id, g.permission_type, NOW(), NOW()
       FROM (${roleSql}) g
      CROSS JOIN menu_groups m
      WHERE m.slug = ?
        AND NOT EXISTS (SELECT 1 FROM role_menu_permissions x WHERE x.role_id = g.role_id AND x.menu_group_id = m.id)`,
    { replacements: [slug] },
  );
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const seeded = await select(context, "SELECT id FROM menu_groups WHERE slug = 'home'");
  if (seeded.length === 0) {
    return; // not seeded yet — the seed creates the groups and ROLE_MENU_ASSIGNMENTS the grants
  }

  for (const menu of NEW_MENUS) {
    await ensureMenu(context, menu);
  }

  // 2. stock: the `warehouse` grant, same type.
  await grant(
    context,
    "stock",
    `SELECT p.role_id, p.permission_type FROM role_menu_permissions p
       JOIN menu_groups w ON w.id = p.menu_group_id WHERE w.slug = 'warehouse'`,
  );
  // 3. storage: write for the tenant-administrator level.
  await grant(
    context,
    "storage",
    `SELECT r.id AS role_id, 'write' AS permission_type FROM roles r
      WHERE COALESCE(r.role_level, 0) >= ${TENANT_ADMIN_LEVEL_SQL} AND r.deleted_at IS NULL`,
  );
  // 4. the Management pages the API serves through another gate.
  for (const [slug, condition] of Object.entries(MANAGEMENT_PAGE_GRANTS)) {
    await grant(
      context,
      slug,
      `SELECT r.id AS role_id, p.permission_type FROM roles r
         JOIN role_menu_permissions p ON p.role_id = r.id
         JOIN menu_groups mg ON mg.id = p.menu_group_id
        WHERE mg.slug = 'management' AND r.name <> 'SUPERADMIN' AND r.deleted_at IS NULL AND (${condition})`,
    );
  }
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const slugs = NEW_MENUS.map((m) => m.slug);
  await context.sequelize.query(
    "DELETE FROM role_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug IN (?)",
    { replacements: [slugs] },
  );
  await context.sequelize.query(
    "DELETE FROM user_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug IN (?)",
    { replacements: [slugs] },
  );
  await context.sequelize.query("DELETE FROM menu_groups WHERE slug IN (?)", { replacements: [slugs] });
};

export = { NEW_MENUS, MANAGEMENT_PAGE_GRANTS, TENANT_ADMIN_LEVEL, up, down };
