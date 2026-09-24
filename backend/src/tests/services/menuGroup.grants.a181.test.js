/**
 * A-181 — menuGroup.service's grant writes (`/menu-groups` assign, revoke,
 * bulk-assign, bulk-revoke) and the delete semantics of a menu with children.
 *
 * Grants: each write that CHANGES a grant commits with ONE audit row under the
 * PLATFORM tenant (a role is global — as roles.service's GRANT_MENU /
 * REVOKE_MENU, A-125), inside the change's transaction; a failed audit insert
 * rolls the grant back; a no-op writes no row; the role's permission cache is
 * cleared after the commit and only then.
 *
 * Delete: a group (or, through roles.service, a menu) with children is 409 and
 * nothing is written — the FK is ON DELETE SET NULL, so before A-181 its
 * grandchildren (roles.service: its children) were promoted to the top level.
 *
 * Effects against the auditLedger fixture (real audit ENUM, NOT NULL columns,
 * migration 0033's actor CHECK, real rollback), `cls: false`: a write that
 * does not pass `{ transaction }` autocommits and the test sees it.
 */
const { createLedger } = require("../fixtures/auditLedger");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const mockRef = { ledger: null, grants: new Map(), groups: [], children: [], group: null, failOn: null };

jest.mock("../../models", () => ({
  Role: { findByPk: async (id) => ({ id, name: "HEALTHCARE ADMIN" }) },
  User: {},
  MenuGroup: {
    findByPk: async (id) => (id === "gone" ? null : mockRef.group),
    findAll: async ({ where, transaction }) => {
      if (where.parentId !== undefined) {
        mockRef.ledger.write("menu_groups_read", { where }, { transaction });
        return mockRef.children;
      }
      return mockRef.groups.filter((g) => where.id.includes(g.id));
    },
    count: async ({ where, transaction }) => {
      mockRef.ledger.write("menu_groups_read", { where }, { transaction });
      return mockRef.children.length;
    },
  },
  RoleMenuPermission: {
    findOrCreate: async ({ where, defaults, transaction }) => {
      const key = `${where.roleId}:${where.menuGroupId}`;
      if (mockRef.grants.has(key)) {
        return [mockRef.grants.get(key), false];
      }
      const row = { id: `perm-${key}`, ...where, ...defaults };
      if (where.menuGroupId === mockRef.failOn) {
        mockRef.ledger.failNext("role_menu_permissions", new Error("second grant failed"));
      }
      mockRef.ledger.write("role_menu_permissions", row, { transaction });
      return [row, true];
    },
    destroy: async ({ where, transaction }) => {
      const key = `${where.roleId}:${where.menuGroupId}`;
      if (where.roleId !== undefined && !mockRef.grants.has(key)) {
        return 0;
      }
      mockRef.ledger.write("role_menu_permissions", { destroyed: where }, { transaction });
      return 1;
    },
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(async () => undefined),
  delPattern: jest.fn(async () => undefined),
  cacheKeys: { permissions: (id) => `permissions:role:${id}` },
}));

const menuGroupService = require("../../services/menuGroup.service");
const RolesService = require("../../services/roles.service");
const redis = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const ROLE = "role-ha";
const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const auditRow = (changes) =>
  expect.objectContaining({
    tenantId: PLATFORM_TENANT_ID,
    userId: "super-1",
    actorType: "user",
    action: "UPDATE",
    resourceType: "Role",
    resourceId: ROLE,
    ipAddress: "10.0.0.7",
    userAgent: "UA",
    changes,
  });

const CASES = [
  {
    name: "assignMenuToRole",
    run: (a) => menuGroupService.assignMenuToRole({ roleId: ROLE, menuGroupId: "mg-1" }, a),
    changes: { operation: "GRANT_MENU", menuGroupId: "mg-1", before: { permissionType: null }, after: { permissionType: "read" } },
  },
  {
    name: "revokeMenuFromRole",
    granted: ["mg-1"],
    run: (a) => menuGroupService.revokeMenuFromRole({ roleId: ROLE, menuGroupId: "mg-1" }, a),
    changes: { operation: "REVOKE_MENU", menuGroupId: "mg-1", before: { granted: true }, after: { granted: false } },
  },
  {
    name: "bulkAssign",
    granted: ["mg-2"],
    run: (a) => menuGroupService.bulkAssign(ROLE, ["mg-1", "mg-2", "mg-missing"], a),
    changes: { operation: "GRANT_MENU", menuGroupIds: ["mg-1"], before: { permissionType: null }, after: { permissionType: "read" } },
  },
  {
    name: "bulkRevoke",
    granted: ["mg-1", "mg-2"],
    run: (a) => menuGroupService.bulkRevoke(ROLE, ["mg-1", "mg-2", "mg-3"], a),
    changes: { operation: "REVOKE_MENU", menuGroupIds: ["mg-1", "mg-2"], before: { granted: true }, after: { granted: false } },
  },
];

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.grants = new Map();
  mockRef.groups = [{ id: "mg-1" }, { id: "mg-2" }, { id: "mg-3" }];
  mockRef.children = [];
  mockRef.failOn = null;
  mockRef.group = { id: "mg-1", name: "Reports", slug: "reports", destroy: async (options) => mockRef.ledger.write("menu_groups", { id: "mg-1", destroyed: true }, options) };
  redis.del.mockClear();
  redis.delPattern.mockClear();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const grant = (...ids) => ids.forEach((id) => mockRef.grants.set(`${ROLE}:${id}`, { id: `perm-${id}` }));

describe("A-181 — menu-group grant writes audit under PLATFORM inside their transaction", () => {
  describe.each(CASES)("$name", ({ run, changes, granted = [] }) => {
    beforeEach(() => grant(...granted));

    it("commits the grant change with exactly one audit row naming the actor, then clears the role's cache", async () => {
      await run(actor);

      expect(mockRef.ledger.committed("role_menu_permissions").length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([auditRow(changes)]);
      expect(redis.del).toHaveBeenCalledWith(`permissions:role:${ROLE}`);
    });

    it("a failing audit insert rolls the grant change back, and the cache is left alone", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run(actor)).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it("a failing grant write leaves no audit row", async () => {
      mockRef.ledger.failNext("role_menu_permissions", new Error("write failed"));

      await expect(run(actor)).rejects.toThrow("write failed");

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("with no actor the change is refused, not committed unattributed (A-124)", async () => {
      await expect(run({})).rejects.toThrow(/must name its actor/);

      expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
    });
  });

  it("assigning a menu the role already holds changes nothing and records nothing", async () => {
    grant("mg-1");

    const perm = await menuGroupService.assignMenuToRole({ roleId: ROLE, menuGroupId: "mg-1" }, actor);

    expect(perm).toEqual({ id: "perm-mg-1" });
    expect(mockRef.ledger.rows).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("revoking a menu the role does not hold changes nothing and records nothing", async () => {
    await menuGroupService.revokeMenuFromRole({ roleId: ROLE, menuGroupId: "mg-1" }, actor);

    expect(mockRef.ledger.rows).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("a bulk assign that grants nothing new records nothing, and reports each id", async () => {
    grant("mg-1");

    const result = await menuGroupService.bulkAssign(ROLE, ["mg-1", "mg-missing"], actor);

    expect(result).toEqual({
      assigned: [],
      alreadyAssigned: ["mg-1"],
      failed: [{ menuGroupId: "mg-missing", error: "Menu group not found" }],
    });
    expect(mockRef.ledger.rows).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("a bulk revoke that removes nothing records nothing", async () => {
    const result = await menuGroupService.bulkRevoke(ROLE, ["mg-1"], actor);

    expect(result).toEqual({ revoked: [], notFound: ["mg-1"] });
    expect(mockRef.ledger.rows).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("a bulk assign is all or nothing: a failed second grant takes the first with it", async () => {
    mockRef.failOn = "mg-2";

    await expect(menuGroupService.bulkAssign(ROLE, ["mg-1", "mg-2"], actor)).rejects.toThrow("second grant failed");

    // Before A-181 mg-1's grant had autocommitted and mg-2 was reported in
    // `failed` — a partial batch nobody had recorded.
    expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});

describe("A-181 — a menu with children is not deleted (409), and nothing is written", () => {
  it("menuGroup.service#deleteMenuGroup refuses a group that has children, naming them", async () => {
    mockRef.children = [{ id: "mg-child", name: "Monthly" }, { id: "mg-child-2", name: "Yearly" }];

    await expect(menuGroupService.deleteMenuGroup("mg-1", actor)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/"Reports" still has 2 child menu\(s\) \(Monthly, Yearly\)/),
    });

    expect(mockRef.ledger.committed("menu_groups")).toEqual([]);
    expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(redis.delPattern).not.toHaveBeenCalled();
  });

  it("menuGroup.service#deleteMenuGroup deletes an empty group with one audit row", async () => {
    await menuGroupService.deleteMenuGroup("mg-1", actor);

    expect(mockRef.ledger.committed("menu_groups")).toEqual([expect.objectContaining({ id: "mg-1", destroyed: true })]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: PLATFORM_TENANT_ID,
        action: "DELETE",
        resourceType: "MenuGroup",
        resourceId: "mg-1",
        changes: { operation: "DELETE_MENU", before: { name: "Reports", slug: "reports" }, after: { deleted: true, revokedGrants: 1 } },
      }),
    ]);
  });

  it("roles.service#deleteMenu refuses a menu that has children the same way", async () => {
    mockRef.children = [{ id: "mg-child", name: "Monthly" }];

    await expect(RolesService.deleteMenu("mg-1", actor)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/"Reports" still has 1 child menu\(s\)/),
    });

    expect(mockRef.ledger.committed("menu_groups")).toEqual([]);
    expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});
