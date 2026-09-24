/**
 * A-173 (ADR-051 Q-14, A-41) — the second write path to the global menu tree,
 * menuGroup.service (`/menu-groups`, SUPERADMIN). Like roles.service's menu
 * functions (A-165), creating, changing or deleting a menu group writes one
 * audit row under the reserved PLATFORM tenant, inside the change's
 * transaction; deleting one revokes its grants and removes its children in
 * that same transaction.
 *
 * Effects against the auditLedger fixture (real audit ENUM, NOT NULL columns,
 * migration 0033's actor CHECK, real rollback), with `cls: false` so every
 * write must carry `{ transaction }` explicitly — an unpassed write
 * autocommits and survives the rollback, and the test sees it.
 */
const { createLedger } = require("../fixtures/auditLedger");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const mockRef = { ledger: null, group: null, children: [], revoked: 3 };

const mockGroupRow = (fields) => {
  const row = { children: [], ...fields };
  row.update = async (values, options) => {
    mockRef.ledger.write("menu_groups", { id: row.id, ...values }, options);
    Object.assign(row, values);
    return row;
  };
  row.destroy = async (options) => mockRef.ledger.write("menu_groups", { id: row.id, destroyed: true }, options);
  return row;
};

jest.mock("../../models", () => ({
  Role: {},
  User: {},
  MenuGroup: {
    create: async (values, options) => {
      mockRef.ledger.write("menu_groups", values, options);
      return { id: "mg-new", children: [], ...values };
    },
    findByPk: async () => mockRef.group,
    findAll: async ({ where, transaction }) => {
      mockRef.ledger.write("menu_groups_read", { where }, { transaction });
      return mockRef.children;
    },
    destroy: async ({ where, transaction }) =>
      mockRef.ledger.write("menu_groups", { destroyed: where }, { transaction }),
  },
  RoleMenuPermission: {
    destroy: async ({ where, transaction }) => {
      mockRef.ledger.write("role_menu_permissions", { destroyed: where }, { transaction });
      return mockRef.revoked;
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
  del: jest.fn(),
  delPattern: jest.fn(async () => undefined),
  cacheKeys: { permissions: (id) => `perm:${id}` },
}));

const menuGroupService = require("../../services/menuGroup.service");
const redis = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const CASES = [
  {
    name: "createMenuGroup",
    run: (a) => menuGroupService.createMenuGroup({ name: "Reports Hub", parentId: "mg-parent", isActive: true }, a),
    action: "CREATE",
    resourceId: "mg-new",
    changes: {
      operation: "CREATE_MENU",
      before: {},
      after: { name: "Reports Hub", slug: "reports-hub", parentId: "mg-parent", isActive: true },
    },
  },
  {
    name: "updateMenuGroup",
    run: (a) => menuGroupService.updateMenuGroup({ id: "mg-1", name: "Renamed", isActive: false }, a),
    action: "UPDATE",
    resourceId: "mg-1",
    changes: {
      operation: "UPDATE_MENU",
      before: { name: "Dashboard", isActive: true },
      after: { name: "Renamed", isActive: false },
    },
  },
  {
    name: "deleteMenuGroup",
    run: (a) => menuGroupService.deleteMenuGroup("mg-1", a),
    action: "DELETE",
    resourceId: "mg-1",
    changes: {
      operation: "DELETE_MENU",
      before: { name: "Dashboard", slug: "dashboard" },
      // A-181: a group with children is refused (409), so none are deleted.
      after: { deleted: true, revokedGrants: 3 },
    },
  },
];

describe("A-173 — menu-group changes audit under PLATFORM inside their transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.group = mockGroupRow({ id: "mg-1", name: "Dashboard", slug: "dashboard", icon: "home", parentId: null, sortOrder: 1, isActive: true });
    mockRef.children = [];
    mockRef.revoked = 3;
    redis.delPattern.mockClear();
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ run, action, resourceId, changes }) => {
    it("commits the change with exactly one audit row under PLATFORM, naming the actor", async () => {
      await run(actor);

      expect(mockRef.ledger.committed("menu_groups").length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: PLATFORM_TENANT_ID,
          userId: "super-1",
          actorType: "user",
          action,
          resourceType: "MenuGroup",
          resourceId,
          ipAddress: "10.0.0.7",
          userAgent: "UA",
          changes,
        }),
      ]);
      expect(redis.delPattern).toHaveBeenCalledWith("permissions:role:*");
    });

    it("a failing audit insert rolls the change back, and the cache is left alone", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run(actor)).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed("menu_groups")).toEqual([]);
      expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
      expect(redis.delPattern).not.toHaveBeenCalled();
    });

    it("a rolled-back change leaves no audit row", async () => {
      mockRef.ledger.failNext("menu_groups", new Error("write failed"));

      await expect(run(actor)).rejects.toThrow("write failed");

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("with no actor the change is refused, not committed unattributed (A-124)", async () => {
      await expect(run({})).rejects.toThrow(/must name its actor/);

      expect(mockRef.ledger.committed("menu_groups")).toEqual([]);
      expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
    });
  });

  it("deleting a group revokes its grants in the same transaction as the delete and its audit row", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(menuGroupService.deleteMenuGroup("mg-1", actor)).rejects.toThrow("audit insert failed");

    // Before A-173 the grant revocation autocommitted: a failed delete left
    // the group in place with every role's grant on it already gone.
    expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
    expect(mockRef.ledger.committed("menu_groups")).toEqual([]);
  });

  it("deleting a group revokes the grants on the group", async () => {
    await menuGroupService.deleteMenuGroup("mg-1", actor);

    expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([
      expect.objectContaining({ destroyed: { menuGroupId: "mg-1" } }),
    ]);
  });

  it("creating a top-level group records null parent and active flag, and leaves the permissions cache alone", async () => {
    await menuGroupService.createMenuGroup({ name: "Top" }, actor);

    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        changes: { operation: "CREATE_MENU", before: {}, after: { name: "Top", slug: "top", parentId: null, isActive: null } },
      }),
    ]);
    expect(redis.delPattern).not.toHaveBeenCalled();
  });

  it("an update records a field the group had no value for as null before", async () => {
    mockRef.group = mockGroupRow({ id: "mg-1", name: "Dashboard", slug: "dashboard", icon: null });

    await menuGroupService.updateMenuGroup({ id: "mg-1", icon: "chart" }, actor);

    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ changes: { operation: "UPDATE_MENU", before: { icon: null }, after: { icon: "chart" } } }),
    ]);
  });

  it("a group that does not exist is 404 and writes nothing", async () => {
    mockRef.group = null;

    await expect(menuGroupService.updateMenuGroup({ id: "gone", name: "x" }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(menuGroupService.deleteMenuGroup("gone", actor)).rejects.toMatchObject({ status: 404 });

    expect(mockRef.ledger.rows).toEqual([]);
  });
});
