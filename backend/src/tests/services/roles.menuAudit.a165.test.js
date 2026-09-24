/**
 * A-165 (ADR-051 Q-14, A-41) — a global menu group is what every role grant
 * points at, so creating, changing or deleting one is a platform operation:
 * each writes one audit row under the reserved PLATFORM tenant, inside the
 * change's transaction.
 *
 * Effects against the auditLedger fixture (real audit ENUM, NOT NULL columns,
 * migration 0033's actor CHECK, real rollback), with `cls: false` so every
 * write must carry `{ transaction }` explicitly.
 */
const { createLedger } = require("../fixtures/auditLedger");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");

const mockRef = { ledger: null, menu: null, revoked: 2 };

const mockMenuRow = (fields) => {
  const row = { ...fields };
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
      return { id: "menu-new", ...values };
    },
    findByPk: async () => mockRef.menu,
    // A-181: deleteMenu refuses a menu with children; these menus have none.
    count: async () => 0,
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

const RolesService = require("../../services/roles.service");
const redis = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actor = { userId: "super-1", tenantId: "home-tenant", ipAddress: "10.0.0.7", userAgent: "UA" };

const CASES = [
  {
    name: "createMenu",
    run: (a) => RolesService.createMenu({ name: " Reports ", parent_id: "menu-parent" }, a),
    action: "CREATE",
    resourceId: "menu-new",
    changes: {
      operation: "CREATE_MENU",
      before: {},
      after: { name: "Reports", slug: "reports", parent_id: "menu-parent", is_active: true },
    },
  },
  {
    name: "updateMenu",
    run: (a) => RolesService.updateMenu("menu-1", { name: "Renamed", is_active: false }, a),
    action: "UPDATE",
    resourceId: "menu-1",
    changes: {
      operation: "UPDATE_MENU",
      before: { name: "Dashboard", is_active: true },
      after: { name: "Renamed", is_active: false },
    },
  },
  {
    name: "deleteMenu",
    run: (a) => RolesService.deleteMenu("menu-1", a),
    action: "DELETE",
    resourceId: "menu-1",
    changes: {
      operation: "DELETE_MENU",
      before: { name: "Dashboard", slug: "dashboard" },
      after: { deleted: true, revokedGrants: 2 },
    },
  },
];

describe("A-165 — global menu changes audit under PLATFORM inside their transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.menu = mockMenuRow({ id: "menu-1", name: "Dashboard", slug: "dashboard", is_active: true });
    mockRef.revoked = 2;
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

  it("deleting a menu revokes its grants in the same transaction as the delete and its audit row", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(RolesService.deleteMenu("menu-1", actor)).rejects.toThrow("audit insert failed");

    // Before A-165 the grant revocation autocommitted: a failed delete left
    // the menu in place with every role's grant on it already gone.
    expect(mockRef.ledger.committed("role_menu_permissions")).toEqual([]);
  });

  it("a menu that does not exist is 404 and writes nothing", async () => {
    mockRef.menu = null;

    await expect(RolesService.updateMenu("gone", { name: "x" }, actor)).rejects.toMatchObject({ statusCode: 404 });
    await expect(RolesService.deleteMenu("gone", actor)).rejects.toMatchObject({ statusCode: 404 });

    expect(mockRef.ledger.rows).toEqual([]);
  });
});
