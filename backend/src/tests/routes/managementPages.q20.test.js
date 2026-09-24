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
const fs = require("fs");
const path = require("path");

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
  cacheKeys: { permissions: (id) => `perm:${id}`, userPermissions: (id) => `uperm:${id}` },
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));

const { Role, RoleMenuPermission } = require("../../models");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS } = require("../../constants");

const SEED = fs.readFileSync(path.join(__dirname, "..", "..", "utils", "seedMenuGroups.util.js"), "utf8");
const MENU_DATA = SEED.slice(SEED.indexOf("const menuData = ["), SEED.indexOf("];", SEED.indexOf("const menuData = [")));
const MENUS = [...MENU_DATA.matchAll(/\{[^{}]*?slug:\s*"([^"]+)"[^{}]*?\}/g)].map((m) => ({
  slug: m[1],
  name: (m[0].match(/name:\s*"([^"]+)"/) || [])[1],
  parentSlug: (m[0].match(/parentSlug:\s*"([^"]+)"/) || [])[1],
}));
const menuRow = (slug) => {
  const menu = MENUS.find((m) => m.slug === slug);
  return menu
    ? { name: menu.name, slug: menu.slug, children: MENUS.filter((c) => c.parentSlug === slug).map((c) => ({ name: c.name, slug: c.slug })) }
    : null;
};
const rowsFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  return Object.entries(entry ? entry.menus : {})
    .map(([slug, permissionType]) => ({ permissionType, menu: menuRow(slug) }))
    .filter((row) => row.menu !== null);
};

const passes = (roleName, resource, action, options) =>
  new Promise((resolve) => {
    const req = {
      user: { id: "11111111-1111-4111-8111-111111111111", tenantId: "33333333-3333-4333-8333-333333333333", role: { id: roleName, name: roleName } },
      params: {},
      body: {},
      query: {},
      headers: {},
      method: "GET",
      originalUrl: "/probe",
    };
    const res = {
      status() {
        return this;
      },
      json() {
        resolve(false);
        return this;
      },
    };
    dynamicAccess(resource, action, options)(req, res, () => resolve(true));
  });

beforeEach(() => {
  Role.findByPk.mockImplementation(async (id) => ({ id, status: "active" }));
  RoleMenuPermission.findAll.mockImplementation(async ({ where }) => rowsFor(where.roleId));
});

const R = ROLE_NAMES;
const ADMINS = [R.HEALTCARE_ADMIN, R.CALIBRATOR_ADMIN];
const OTHERS = [R.ENGINEERING_MANAGER, R.SUPERVISOR, R.TECHNICIAN, R.HEALTHCARE_TECHNICIAN, R.FACILITY_MAINTENANCE, R.WAREHOUSE_STAFF, R.ROOM_USER, R.USER];
const T = { checkTenant: true };

// [resource, action, options, roles that must pass] — every other seeded
// tenant role must be refused.
const GATES = [
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
  it.each(GATES)("%s:%s", async (resource, action, options, allowed) => {
    for (const role of [...ADMINS, ...OTHERS]) {
      await expect({ role, passed: await passes(role, resource, action, options) }).toEqual({
        role,
        passed: allowed.includes(role),
      });
    }
  });
});
