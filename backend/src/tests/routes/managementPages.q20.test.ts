/**
 * Q-20 (ADR-056) — who reaches the five Management pages only
 * SUPERADMIN could reach on a fresh seed.
 *
 * The REAL `dynamicAccess` gate and the REAL
 * `RolesService.getRolePermissionsMatrix`, over `role_menu_permissions` rows
 * built from `ROLE_MENU_ASSIGNMENTS` and the real seed's menu tree (as
 * migration.service seeds them; the fixture of dynamicAccessReach.a07 and
 * finance.access.a07). Each gate is called exactly as its route declares it.
 *
 * Decision: the admin roles manage users and vendors, read billing and the
 * audit trail; ENGINEERING MANAGER reads vendors; nobody but SUPERADMIN
 * writes billing (PATCH /billing/subscription can set `status`) or touches
 * the platform blog (`content`).
 */
import * as fs from "fs";
import * as path from "path";
import type * as Models from "../../models";
import type * as Constants from "../../constants";

type DynamicAccessGate = (req: unknown, res: unknown, next: () => void) => void;

interface DynamicAccessMiddleware {
  dynamicAccess: (menuGroup: string, permissionType: string, options?: { checkTenant?: boolean }) => DynamicAccessGate;
}

jest.mock("../../models", () => ({
  Role: { findByPk: jest.fn() },
  RoleMenuPermission: { findAll: jest.fn() },
  MenuGroup: {},
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: { permissions: (id: string) => `perm:${id}`, userPermissions: (id: string) => `uperm:${id}` },
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { Role, RoleMenuPermission } = require("../../models") as typeof Models as unknown as {
  Role: { findByPk: jest.Mock };
  RoleMenuPermission: { findAll: jest.Mock };
};
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware") as DynamicAccessMiddleware;
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS } = require("../../constants") as typeof Constants;
/* eslint-enable @typescript-eslint/no-require-imports */

interface MenuNode {
  slug: string;
  name: string | undefined;
  parentSlug: string | undefined;
}

interface RoleMenuAssignment {
  roleName: string;
  menus: Record<string, unknown>;
}

const SEED = fs.readFileSync(path.join(__dirname, "..", "..", "utils", "seedMenuGroups.util.ts"), "utf8");
const MENU_DATA = SEED.slice(SEED.indexOf("const menuData = ["), SEED.indexOf("];", SEED.indexOf("const menuData = [")));
const MENUS: MenuNode[] = [...MENU_DATA.matchAll(/\{[^{}]*?slug:\s*"([^"]+)"[^{}]*?\}/g)].map((m) => ({
  slug: m[1] ?? "",
  name: ((/name:\s*"([^"]+)"/.exec(m[0])) ?? [])[1],
  parentSlug: ((/parentSlug:\s*"([^"]+)"/.exec(m[0])) ?? [])[1],
}));
const menuRow = (slug: string): { name: string | undefined; slug: string; children: { name: string | undefined; slug: string }[] } | null => {
  const menu = MENUS.find((m) => m.slug === slug);
  return menu
    ? { name: menu.name, slug: menu.slug, children: MENUS.filter((c) => c.parentSlug === slug).map((c) => ({ name: c.name, slug: c.slug })) }
    : null;
};
const rowsFor = (roleName: string): { permissionType: unknown; menu: unknown }[] => {
  const entry = (ROLE_MENU_ASSIGNMENTS as RoleMenuAssignment[]).find((a) => a.roleName === roleName);
  return Object.entries(entry ? entry.menus : {})
    .map(([slug, permissionType]) => ({ permissionType, menu: menuRow(slug) }))
    .filter((row) => row.menu !== null);
};

interface ProbeReq {
  user: { id: string; tenantId: string; role: { id: string; name: string } };
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  method: string;
  originalUrl: string;
}

interface ProbeRes {
  status(): ProbeRes;
  json(): ProbeRes;
}

const passes = (roleName: string, resource: string, action: string, options?: { checkTenant?: boolean }): Promise<boolean> =>
  new Promise((resolve) => {
    const req: ProbeReq = {
      user: { id: "11111111-1111-4111-8111-111111111111", tenantId: "33333333-3333-4333-8333-333333333333", role: { id: roleName, name: roleName } },
      params: {},
      body: {},
      query: {},
      headers: {},
      method: "GET",
      originalUrl: "/probe",
    };
    const res: ProbeRes = {
      status(): ProbeRes {
        return this;
      },
      json(): ProbeRes {
        resolve(false);
        return this;
      },
    };
    (dynamicAccess(resource, action, options))(req, res, () => {
      resolve(true);
    });
  });

beforeEach(() => {
  Role.findByPk.mockImplementation((id: string) => Promise.resolve({ id, status: "active" }));
  RoleMenuPermission.findAll.mockImplementation(({ where }: { where: { roleId: string } }) => Promise.resolve(rowsFor(where.roleId)));
});

const R = ROLE_NAMES;
const ADMINS = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];
const OTHERS = [R.ENGINEERING_MANAGER, R.SUPERVISOR, R.TECHNICIAN, R.HEALTHCARE_TECHNICIAN, R.FACILITY_MAINTENANCE, R.WAREHOUSE_STAFF, R.ROOM_USER, R.USER];
const T = { checkTenant: true };

// [resource, action, options, roles that must pass] — every other seeded
// tenant role must be refused.
const GATES: [string, string, { checkTenant: boolean } | undefined, string[]][] = [
  ["users", "read", T, ADMINS],
  ["users", "create", T, ADMINS],
  ["users", "update", T, ADMINS],
  ["users", "delete", T, ADMINS],
  ["vendors", "read", T, [...ADMINS, R.ENGINEERING_MANAGER]],
  ["vendors", "create", T, ADMINS],
  ["vendors", "delete", T, ADMINS],
  ["billing", "read", T, ADMINS],
  ["billing", "update", T, []],
  ["audit", "read", T, ADMINS],
  ["content", "read", undefined, []],
  ["content", "create", undefined, []],
];

describe("Q-20 — the Management pages, per seeded role", () => {
  it.each(GATES)("%s:%s", async (resource: string, action: string, options: { checkTenant: boolean } | undefined, allowed: string[]) => {
    for (const role of [...ADMINS, ...OTHERS]) {
      const passed = await passes(role, resource, action, options);
      expect({ role, passed }).toEqual({
        role,
        passed: allowed.includes(role),
      });
    }
  });
});
