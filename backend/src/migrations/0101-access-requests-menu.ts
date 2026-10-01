/**
 * P10-07 (ADR-098 §6) — the `access-requests` menu entry (the super admin's
 * queue, /dashboard/access-requests) and its one grant: SUPERADMIN, write.
 *
 * The seed (`seedMenuGroups.util.js`, `ROLE_MENU_ASSIGNMENTS`) creates both on
 * a database seeded from now on; this does the same for an already-seeded one
 * (the 0020/0021/0025/0038 trap: the seed never updates an existing database).
 * No other role gets it: the queue's API is the admin router's
 * `rbac(SUPER_ADMIN)`, and a tenant role granted the menu would see an entry
 * whose every call answers 403.
 *
 * On a database that has NOT been seeded (no `home` menu group), this does
 * nothing: the seed creates the group and the grant itself.
 *
 * Cache note (as 0038): flush `<prefix>permissions:*` after this runs, or the
 * super admin's sidebar keeps the old menu until the keys expire.
 *
 * No try/catch: a failure fails the migration (CLAUDE.md). Verify with psql:
 *   SELECT m.slug, m.parent_id IS NOT NULL AS nested, r.name, p.permission_type
 *     FROM menu_groups m
 *     LEFT JOIN role_menu_permissions p ON p.menu_group_id = m.id
 *     LEFT JOIN roles r ON r.id = p.role_id
 *    WHERE m.slug = 'access-requests';
 *   -- one row: access-requests | t | SUPERADMIN | write
 */
import type { QueryInterface } from "sequelize";

const SLUG = "access-requests";
const FIXED_ID = "a0000000-0000-0000-0000-000000000237";
const PARENT_SLUG = "mgmt-organization";
const ROLE_NAME = "SUPERADMIN";

const ids = async (context: QueryInterface, sql: string, bind: readonly string[] = []): Promise<string[]> => {
  const [rows] = (await context.sequelize.query(sql, { bind: [...bind] })) as [{ id: string }[], unknown];
  return rows.map((row) => row.id);
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  if ((await ids(context, "SELECT id FROM menu_groups WHERE slug = 'home'")).length === 0) {
    return; // not seeded yet — the seed creates the group and its grant
  }
  if ((await ids(context, "SELECT id FROM menu_groups WHERE slug = $1", [SLUG])).length === 0) {
    const idTaken = (await ids(context, "SELECT id FROM menu_groups WHERE id = $1", [FIXED_ID])).length > 0;
    const parent = await ids(context, "SELECT id FROM menu_groups WHERE slug = $1", [PARENT_SLUG]);
    await context.sequelize.query(
      `INSERT INTO menu_groups (id, name, slug, icon, parent_id, sort_order, is_active, created_at, updated_at)
       VALUES (${idTaken ? "gen_random_uuid()" : "$3::uuid"}, 'Access Requests', $1, 'Inbox', $2::uuid, 6, true, NOW(), NOW())`,
      { bind: idTaken ? [SLUG, parent[0] ?? null] : [SLUG, parent[0] ?? null, FIXED_ID] },
    );
  }
  await context.sequelize.query(
    `INSERT INTO role_menu_permissions (id, role_id, menu_group_id, permission_type, created_at, updated_at)
     SELECT gen_random_uuid(), r.id, m.id, 'write', NOW(), NOW()
       FROM roles r CROSS JOIN menu_groups m
      WHERE r.name = $1 AND m.slug = $2
        AND NOT EXISTS (SELECT 1 FROM role_menu_permissions x WHERE x.role_id = r.id AND x.menu_group_id = m.id)`,
    { bind: [ROLE_NAME, SLUG] },
  );
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query(
    "DELETE FROM role_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug = $1",
    { bind: [SLUG] },
  );
  await context.sequelize.query(
    "DELETE FROM user_menu_permissions p USING menu_groups m WHERE p.menu_group_id = m.id AND m.slug = $1",
    { bind: [SLUG] },
  );
  await context.sequelize.query("DELETE FROM menu_groups WHERE slug = $1", { bind: [SLUG] });
};

export = { SLUG, FIXED_ID, PARENT_SLUG, ROLE_NAME, up, down };
