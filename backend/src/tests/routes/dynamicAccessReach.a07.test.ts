/**
 * A-07 follow-up — which `dynamicAccess` gates NO seeded role can pass.
 *
 * A gate can name a real, seeded slug and still grant nobody but SUPERADMIN
 * (which bypasses the matrix): `getRolePermissionsMatrix` inherits a grant to a
 * menu's DIRECT children only, and the Management tree is three levels deep
 * (`management` → `mgmt-organization` → `users`). `ROLE_MENU_ASSIGNMENTS`
 * grants `management`, so every admin role inherits the `mgmt-*` sub-group
 * headings — and none of the pages under them unless granted by slug.
 *
 * This test computes, with the REAL `RolesService.getRolePermissionsMatrix`
 * over `role_menu_permissions` rows built from `ROLE_MENU_ASSIGNMENTS` and the
 * real seed's menu tree, which gates no seeded non-SUPERADMIN role holds ANY
 * permission for (read or write) on a fresh install. It pins the answer to a
 * reviewed list, so:
 *
 *   - a NEW gate that nobody can pass fails here, naming itself;
 *   - granting one of the listed slugs (the open question below) fails here
 *     too, so the list shrinks with the fix instead of rotting.
 *
 * The list is NOT an endorsement. Whether HEALTHCARE ADMIN / CALIBRATOR ADMIN
 * should manage users, vendors, billing, content or read the audit log is an
 * owner decision (TASKS/AUDIT-2026-09-REMEDIATION.md, A-07, "left open").
 */

import * as fs from "fs";
import * as path from "path";

jest.mock("../../models", () => ({
  Role: { findByPk: jest.fn(), findAll: jest.fn() },
  RoleMenuPermission: { findAll: jest.fn() },
  MenuGroup: {},
  User: { findByPk: jest.fn() },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: { permissions: (id: string) => `perm:${id}` },
}));

interface RoleRow {
  roleName: string;
  menus: Record<string, unknown>;
}

interface MenuNode {
  slug: string;
  name: string | undefined;
  parentSlug: string | undefined;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { Role, RoleMenuPermission } = require("../../models") as {
  Role: { findByPk: jest.Mock };
  RoleMenuPermission: { findAll: jest.Mock };
};
const RolesService = require("../../services/roles.service") as {
  getRolePermissionsMatrix: (roleName: string) => Promise<Record<string, unknown[]>>;
};
const { ROLE_MENU_ASSIGNMENTS, ROLE_NAMES } = require("../../constants") as {
  ROLE_MENU_ASSIGNMENTS: RoleRow[];
  ROLE_NAMES: Record<string, string>;
};
const { collectRouteGates } = require("../../utils/authorizationWiring.util") as {
  collectRouteGates: () => { names: string[] | null }[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Reviewed 2026-09-24: seeded slugs that route gates use and that no seeded
// role other than SUPERADMIN holds, directly or by one-level inheritance.
// Q-20 (2026-09-24, ADR-056): users, vendors, billing and audit are
// granted by slug to the admin roles (vendors read also to ENGINEERING
// MANAGER). `content` — the platform-wide public blog — stays SUPERADMIN-only
// on purpose.
const KNOWN_SUPERADMIN_ONLY = ["content"];

const SEED = fs.readFileSync(
  path.join(__dirname, "..", "..", "utils", "seedMenuGroups.util.ts"),
  "utf8",
);
const START = SEED.indexOf("const menuData = [");
const MENU_DATA = SEED.slice(START, SEED.indexOf("];", START));
const MENUS: MenuNode[] = [...MENU_DATA.matchAll(/\{[^{}]*?slug:\s*"([^"]+)"[^{}]*?\}/g)].map((m) => ({
  slug: m[1] as string,
  name: ((/name:\s*"([^"]+)"/.exec(m[0])) ?? [])[1],
  parentSlug: ((/parentSlug:\s*"([^"]+)"/.exec(m[0])) ?? [])[1],
}));
const menuRow = (slug: string): { name: string | undefined; slug: string; children: { name: string | undefined; slug: string }[] } | null => {
  const menu = MENUS.find((m) => m.slug === slug);
  return menu
    ? {
      name: menu.name,
      slug: menu.slug,
      children: MENUS.filter((c) => c.parentSlug === slug).map((c) => ({
        name: c.name,
        slug: c.slug,
      })),
    }
    : null;
};
const rowsFor = (roleName: string): { permissionType: unknown; menu: unknown }[] => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  return Object.entries(entry ? entry.menus : {})
    .map(([slug, permissionType]) => ({ permissionType, menu: menuRow(slug) }))
    .filter((row) => row.menu !== null);
};

beforeEach(() => {
  Role.findByPk.mockImplementation((id: string) => Promise.resolve({ id, status: "active" }));
  RoleMenuPermission.findAll.mockImplementation(({ where }: { where: { roleId: string } }) =>
    Promise.resolve(rowsFor(where.roleId)),
  );
});

describe("A-07 — gates no seeded role can pass", () => {
  it("the fixture parsed the seed tree (a tree of nothing proves nothing)", () => {
    expect(MENUS.length).toBeGreaterThan(40);
    expect(menuRow("users")).toMatchObject({ name: "Users" });
    expect(MENUS.find((m) => m.slug === "users")?.parentSlug).toBe("mgmt-organization");
  });

  it("the unreachable set is exactly the reviewed list", async () => {
    expect(ROLE_NAMES["SUPER_ADMIN"]).toBe("SUPERADMIN"); // the one role excluded below
    const matrices: Record<string, unknown[]>[] = [];
    for (const { roleName } of ROLE_MENU_ASSIGNMENTS) {
      if (roleName !== ROLE_NAMES["SUPER_ADMIN"]) {
        matrices.push(await RolesService.getRolePermissionsMatrix(roleName));
      }
    }
    expect(matrices.length).toBeGreaterThan(5);

    const unreachable = new Set<string>();
    for (const gate of collectRouteGates()) {
      if (gate.names === null) {
        continue; // computed (search) — its menus are reachable; see dynamicAccessSlugs.a07
      }
      const reachable = gate.names.some((name: string) =>
        matrices.some((matrix) => (matrix[name] ?? []).length > 0),
      );
      if (!reachable) {
        gate.names.forEach((name: string) => unreachable.add(name));
      }
    }

    expect([...unreachable].sort()).toEqual(KNOWN_SUPERADMIN_ONLY);
  });
});
