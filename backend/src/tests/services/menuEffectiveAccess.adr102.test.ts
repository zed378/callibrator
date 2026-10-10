/**
 * ADR-102 — the sidebar shows exactly what the API serves, per role, on the
 * seeded grants.
 *
 * Before: menuGroup.service#getRoleMenuAssignments showed a node when it or
 * ANY ANCESTOR was granted, while the API (dynamicAccess → roles.service
 * #getRolePermissionsMatrix) inherits a grant ONE level down, and the sidebar
 * ignored per-user overrides. A `management` grant therefore showed HEALTHCARE
 * ADMIN, CALIBRATOR ADMIN and ENGINEERING MANAGER Management pages the API
 * refused (Roles, Menu Groups, Blog, …), a `none` override left the entry in
 * place, and an extra per-user grant never appeared (F1, F9).
 *
 * The seed is REAL (fixtures/seededAuthorization: seedMenuGroups +
 * ROLE_MENU_ASSIGNMENTS through migration.service), the matrix is the REAL
 * getRolePermissionsMatrix, and the menu is the REAL getRoleMenuAssignments.
 * The expected menus below are written out by hand from the route gates
 * (constants/menuPageAccess quotes them) — they are the claim, not something
 * derived from the code under test.
 *
 * Fail-before: with the ancestor cascade, HEALTHCARE ADMIN's menu held
 * /dashboard/roles, /dashboard/menu-groups and /dashboard/content, Home went
 * to "/", and the override cases below did not change the menu.
 */
import { ROLE_LEVELS, ROLE_NAMES } from "../../constants/roleConstants";
import { toUserId } from "../../types/ids";

interface MenuRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}
interface Seed {
  seed(): Promise<unknown>;
  roleId(name: string): string;
  menuGroups: MenuRow[];
  MenuGroup: { findOne(...a: unknown[]): unknown; create(...a: unknown[]): unknown };
  RoleMenuPermission: {
    findAll(...a: unknown[]): unknown;
    findOne(...a: unknown[]): unknown;
    create(...a: unknown[]): unknown;
    destroy(...a: unknown[]): unknown;
  };
  Roles: { findOne(...a: unknown[]): unknown; findByPk(...a: unknown[]): unknown };
}
interface MenuNode {
  label: string;
  path: string;
  items?: MenuNode[];
}

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories and the JavaScript seed/service graph; typed by the members used */
const mockSeed: { current: Seed | null } = { current: null };
const mockOverrides: { current: Record<string, string> } = { current: {} };
const seed = (): Seed => {
  if (!mockSeed.current) {throw new Error("seed not created");}
  return mockSeed.current;
};

/** fetchActiveParentGroups: active top-level rows, each with active children and grandchildren. */
const mockTree = (): unknown[] => {
  const rows = seed().menuGroups.filter((g) => g.isActive);
  const bySort = (a: MenuRow, b: MenuRow): number => a.sortOrder - b.sortOrder;
  const withChildren = (row: MenuRow, depth: number): Record<string, unknown> => ({
    ...row,
    children:
      depth === 0
        ? []
        : rows
          .filter((c) => c.parentId === row.id)
          .sort(bySort)
          .map((c) => withChildren(c, depth - 1)),
  });
  return rows.filter((g) => g.parentId === null).sort(bySort).map((g) => withChildren(g, 2));
};

jest.mock("../../models", () => {
  const roles = {
    findOne: (...args: unknown[]) => seed().Roles.findOne(...args),
    findByPk: (...args: unknown[]) => seed().Roles.findByPk(...args),
  };
  return {
    Tenants: { findByPk: jest.fn() },
    User: { findByPk: jest.fn() },
    Users: { findByPk: jest.fn() },
    Role: roles,
    Roles: roles,
    MenuGroup: {
      findAll: (options: { where?: { parentId?: unknown; isActive?: boolean } } = {}) =>
        Promise.resolve(
          options.where?.parentId === null
            ? mockTree()
            : seed().menuGroups.filter((g) => g.isActive),
        ),
      findOne: (...args: unknown[]) => seed().MenuGroup.findOne(...args),
      create: (...args: unknown[]) => seed().MenuGroup.create(...args),
    },
    RoleMenuPermission: {
      findAll: (...args: unknown[]) => seed().RoleMenuPermission.findAll(...args),
      findOne: (...args: unknown[]) => seed().RoleMenuPermission.findOne(...args),
      create: (...args: unknown[]) => seed().RoleMenuPermission.create(...args),
      destroy: (...args: unknown[]) => seed().RoleMenuPermission.destroy(...args),
    },
  };
});
jest.mock("../../services/featureFlag.service", () => ({}));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn(() => Promise.resolve(mockOverrides.current)),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: {
    permissions: (id: string) => `permissions:${id}`,
    userPermissions: (id: string) => `userPermissions:${id}`,
  },
}));

const { createSeededAuthorization } = require("../fixtures/seededAuthorization") as {
  createSeededAuthorization: () => Seed;
};
const menuGroupService = require("../../services/menuGroup.service") as {
  getRoleMenuAssignments(roleId: string, requester?: object | null): Promise<MenuNode[]>;
  getMyPermissions(requester: object): Promise<{ superAdmin: boolean; permissions: Record<string, string> }>;
  mapSlugToPath(slug: string): string;
};
const { principalHasMenuPermission } = require("../../middlewares/dynamicAccess.middleware") as {
  principalHasMenuPermission: (principal: object, menu: string, type: string) => Promise<boolean>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const USER_ID = toUserId("0f0f0f0f-0000-4000-8000-000000000102");
const levelOf = (name: string): number => {
  const key = (Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]).find((k) => ROLE_NAMES[k] === name);
  return key ? ROLE_LEVELS[key] : 0;
};
const requesterFor = (name: string): object => ({
  id: USER_ID,
  role: { id: seed().roleId(name), name, roleLevel: levelOf(name) },
});

/** Every leaf path of a menu tree, top-level links included. */
const leafPaths = (nodes: readonly MenuNode[]): string[] =>
  nodes.flatMap((n) => (n.items && n.items.length > 0 ? leafPaths(n.items) : [n.path]));

const menuOf = async (name: string): Promise<string[]> =>
  leafPaths(await menuGroupService.getRoleMenuAssignments(seed().roleId(name), requesterFor(name))).sort();

const paths = (slugs: readonly string[]): string[] =>
  [...new Set(slugs.map((s) => menuGroupService.mapSlugToPath(s)))].sort();

const ACCOUNT = ["change-password", "profile-page", "notifications"];
// P22-01 landed (migration 0130, ADR-126 Am. 6 § 8): `ipm-templates` is active — every role holding the equipment group sees it.
// P22-04 landed (migration 0131): `ipm` (the IPM history page) is active too, for the same roles.
const EQUIPMENT = ["calibration", "certificate", "maintenance", "calibration-scheduler", "reports", "predictive-maintenance", "ipm-templates", "ipm"];
const TOP = ["home", "warehouse", "stock"];

/** The claim: what each seeded role can open without a 403 (route gates by hand). */
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  [ROLE_NAMES.HEALTCARE_ADMIN]: [
    ...TOP, ...ACCOUNT, ...EQUIPMENT,
    "tenants", "tenant-hierarchy", "tenant-lifecycle", "users",
    "kanban", "workflows", "batch-jobs", "tickets-raise", "tickets-response",
    "qms", "sop", "risk", "audit", "data-retention", "esignature", "ai-assistant",
    "billing", "finance", "metered-billing", "vendors", "supplier-scorecard",
    "api-keys", "webhooks", "feature-flags", "attachments", "storage",
    "client-facilities", // P22-09 (migration 0132)
    // `scim` is not here: its API serves only the super admin and SCIM keys.
    "oidc", "webauthn", "network-security", "gdpr", "custom-domains",
  ],
  [ROLE_NAMES.CALIBRATOR_ADMIN]: [
    ...TOP, ...ACCOUNT, ...EQUIPMENT,
    "tenants", "tenant-hierarchy", "tenant-lifecycle", "users",
    "kanban", "workflows", "batch-jobs", "tickets-raise", "tickets-response",
    "qms", "sop", "risk", "audit", "data-retention", "esignature", "ai-assistant",
    "billing", "finance", "metered-billing", "vendors", "supplier-scorecard",
    "api-keys", "webhooks", "feature-flags", "attachments", "storage",
    "client-facilities", // P22-09 (migration 0132)
  ],
  [ROLE_NAMES.ENGINEERING_MANAGER]: [
    ...TOP, ...ACCOUNT, ...EQUIPMENT,
    "tenants", "tenant-hierarchy",
    "kanban", "workflows", "tickets-raise", "tickets-response",
    "qms", "sop", "risk", "esignature", "ai-assistant",
    "finance", "vendors", "supplier-scorecard", "attachments",
    "client-facilities", // P22-09 (migration 0132): read
  ],
  [ROLE_NAMES.SUPERVISOR]: [...TOP, ...ACCOUNT, ...EQUIPMENT, "kanban", "tickets-raise", "tickets-response", "esignature"],
  [ROLE_NAMES.TECHNICIAN]: [...TOP, "profile-page", ...EQUIPMENT, "kanban", "tickets-raise", "esignature"],
  [ROLE_NAMES.HEALTHCARE_TECHNICIAN]: [...TOP, "profile-page", ...EQUIPMENT, "tickets-raise", "esignature"],
  [ROLE_NAMES.FACILITY_MAINTENANCE]: [...TOP, "profile-page", ...EQUIPMENT, "tickets-raise", "esignature"],
  [ROLE_NAMES.WAREHOUSE_STAFF]: [...TOP, "profile-page", ...EQUIPMENT, "tickets-raise"],
  [ROLE_NAMES.ROOM_USER]: [...TOP, "profile-page", ...EQUIPMENT, "tickets-raise"],
  [ROLE_NAMES.USER]: [...TOP, ...ACCOUNT, ...EQUIPMENT, "tickets-raise"],
};

beforeEach(async () => {
  mockOverrides.current = {};
  mockSeed.current = createSeededAuthorization();
  await seed().seed();
});

describe("ADR-102 — each seeded role's sidebar is what the API serves", () => {
  it.each(Object.keys(EXPECTED))("%s", async (name) => {
    expect(await menuOf(name)).toEqual(paths(EXPECTED[name] ?? []));
  });

  it("SUPERADMIN sees every page but Raise a Ticket (the service refuses it, BR-13)", async () => {
    const menu = await menuOf(ROLE_NAMES.SUPER_ADMIN);
    // Every ACTIVE leaf: P20-06 seeds `ipm`, `ipm-templates`, `client-facilities` inactive until their
    // pages ship (ADR-124 Am. 5 § 2) — `ipm-templates` is active since P22-01 (0130), `ipm` since P22-04
    // (0131), `client-facilities` since P22-09 (0132).
    const allLeaves = seed()
      .menuGroups.filter((g) => g.isActive && !seed().menuGroups.some((c) => c.parentId === g.id))
      .map((g) => g.slug)
      .filter((slug) => slug !== "tickets-raise");
    expect(menu).toEqual(paths(allLeaves));
    expect(menu).not.toContain("/dashboard/tickets/raise");
    expect(menu).toContain("/dashboard/ipm");
    expect(menu).toContain("/dashboard/client-facilities"); // P22-09 (0132): all three P20-06 entries active
  });

  it("no entry the old ancestor cascade showed and the API refuses (HEALTHCARE ADMIN)", async () => {
    const menu = await menuOf(ROLE_NAMES.HEALTCARE_ADMIN);
    for (const refused of ["/dashboard/roles", "/dashboard/menu-groups", "/dashboard/content", "/dashboard/permissions"]) {
      expect(menu).not.toContain(refused);
    }
  });

  it("Home is the dashboard home, shown once, never the public landing page", async () => {
    const tree = await menuGroupService.getRoleMenuAssignments(
      seed().roleId(ROLE_NAMES.TECHNICIAN),
      requesterFor(ROLE_NAMES.TECHNICIAN),
    );
    const top = tree.map((n) => n.path);
    expect(top.filter((p) => p === "/dashboard")).toHaveLength(1);
    expect(top).not.toContain("/");
  });

  it("every shown menu-gated entry passes the REAL dynamicAccess read check for its own slug", async () => {
    for (const name of Object.keys(EXPECTED)) {
      const principal = requesterFor(name);
      for (const slug of EXPECTED[name] ?? []) {
        expect([name, slug, await principalHasMenuPermission(principal, slug, "read")]).toEqual([name, slug, true]);
      }
    }
  });
});

describe("ADR-102 — per-user overrides reach the sidebar (they already reached the API)", () => {
  it("a `none` override removes the entry", async () => {
    mockOverrides.current = { kanban: "none" };
    expect(await menuOf(ROLE_NAMES.TECHNICIAN)).not.toContain("/dashboard/kanban");
  });

  it("a per-user grant adds the entry, under its group", async () => {
    mockOverrides.current = { audit: "read" };
    expect(await menuOf(ROLE_NAMES.TECHNICIAN)).toContain("/dashboard/audit");
  });

  it("a super admin previewing ANOTHER role gets that role's menu, without the super admin's overrides", async () => {
    mockOverrides.current = { audit: "read" };
    const superAdmin = requesterFor(ROLE_NAMES.SUPER_ADMIN);
    const tree = await menuGroupService.getRoleMenuAssignments(seed().roleId(ROLE_NAMES.TECHNICIAN), superAdmin);
    expect(leafPaths(tree).sort()).toEqual(paths(EXPECTED[ROLE_NAMES.TECHNICIAN] ?? []));
  });

  it("an unknown role has an empty menu", async () => {
    expect(await menuGroupService.getRoleMenuAssignments("00000000-0000-4000-8000-000000000999", null)).toEqual([]);
  });
});

describe("ADR-102 — GET /menu-groups/my-permissions", () => {
  it("answers the effective access per slug: one level of inheritance, write implies read", async () => {
    const mine = await menuGroupService.getMyPermissions(requesterFor(ROLE_NAMES.CALIBRATOR_ADMIN));
    expect(mine.superAdmin).toBe(false);
    // `equipment` write reaches its children (the API rule) …
    expect(mine.permissions["calibration"]).toBe("write");
    expect(mine.permissions["certificate"]).toBe("write");
    // … `management` write reaches its sub-groups, not their pages.
    expect(mine.permissions["mgmt-content"]).toBe("write");
    expect(mine.permissions["content"]).toBeUndefined();
    expect(mine.permissions["warehouse"]).toBe("read");
  });

  it("WAREHOUSE STAFF holds equipment READ (the hard-coded UI gave it device write buttons)", async () => {
    const mine = await menuGroupService.getMyPermissions(requesterFor(ROLE_NAMES.WAREHOUSE_STAFF));
    expect(mine.permissions["calibration"]).toBe("read");
    expect(mine.permissions["warehouse"]).toBe("write");
  });

  it("an override replaces the role's access", async () => {
    mockOverrides.current = { calibration: "write", warehouse: "none" };
    const mine = await menuGroupService.getMyPermissions(requesterFor(ROLE_NAMES.WAREHOUSE_STAFF));
    expect(mine.permissions["calibration"]).toBe("write");
    expect(mine.permissions["warehouse"]).toBeUndefined();
  });

  it("the super admin is flagged and holds write everywhere", async () => {
    const mine = await menuGroupService.getMyPermissions(requesterFor(ROLE_NAMES.SUPER_ADMIN));
    expect(mine.superAdmin).toBe(true);
    expect(mine.permissions["roles"]).toBe("write");
  });
});
