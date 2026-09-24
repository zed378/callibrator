/**
 * A-41 — role and permission changes decide who can do what; each writes its
 * audit row inside the same transaction as the change
 * (MEMORY/specs/A-41-audit-inside-transaction.md, rows 16–24).
 *
 * Effects against the auditLedger fixture (real ENUM, real rollback), with
 * `cls: false` so every write must carry `{ transaction }` explicitly.
 *
 * BR-A41-4: a change to a GLOBAL role is recorded under the actor's tenant; a
 * change to a USER's role or override is recorded under that user's tenant.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, role: null, user: null, grant: null, removed: 1 };

const mockRow = (table, fields) => {
  const row = { ...fields };
  row.update = async (values, options) => {
    Object.assign(row, values);
    return mockRef.ledger.write(table, { id: row.id, ...values }, options);
  };
  row.save = async (options) => mockRef.ledger.write(table, { id: row.id, role_id: row.role_id }, options);
  row.destroy = async (options) => mockRef.ledger.write(table, { id: row.id, destroyed: true }, options);
  return row;
};

jest.mock("../../models", () => ({
  Role: {
    create: async (values, options) => {
      mockRef.ledger.write("roles", values, options);
      return { id: "role-new", ...values };
    },
    findByPk: async () => mockRef.role,
  },
  RoleMenuPermission: {
    findOrCreate: async ({ where, defaults, transaction }) => {
      if (mockRef.grant) {return [mockRef.grant, false];}
      mockRef.ledger.write("role_menu_permissions", { ...where, ...defaults }, { transaction });
      return [{ id: "grant-new", ...where, ...defaults }, true];
    },
    destroy: async ({ where, transaction }) => {
      mockRef.ledger.write("role_menu_permissions", { destroyed: where }, { transaction });
      return mockRef.removed;
    },
  },
  MenuGroup: { findByPk: async () => ({ id: "menu-1" }) },
  User: { findByPk: async () => mockRef.user },
  UserMenuPermission: {
    findOrCreate: async ({ where, defaults, transaction }) => {
      if (mockRef.grant) {return [mockRef.grant, false];}
      mockRef.ledger.write("user_menu_permissions", { ...where, ...defaults }, { transaction });
      return [{ id: "ovr-new", ...where, ...defaults }, true];
    },
    destroy: async ({ where, transaction }) => {
      mockRef.ledger.write("user_menu_permissions", { destroyed: where }, { transaction });
      return mockRef.removed;
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
  delPattern: jest.fn(),
  cacheKeys: {
    permissions: (id) => `perm:${id}`,
    userPermissions: (id) => `uperm:${id}`,
  },
}));

const RolesService = require("../../services/roles.service");
const userPermissionService = require("../../services/userPermission.service");
const redis = require("../../services/redis.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actor = { userId: "admin-1", tenantId: "tenant-admin", ipAddress: "10.0.0.1", userAgent: "UA" };

const CASES = [
  {
    name: "createRole",
    run: () => RolesService.createRole({ name: "Auditor", roleLevel: 3 }, actor),
    table: "roles",
    action: "CREATE",
    resourceType: "Role",
    resourceId: "role-new",
    tenantId: "tenant-admin",
  },
  {
    name: "updateRole",
    run: () => RolesService.updateRole("role-1", { status: "inactive" }, actor),
    table: "roles",
    action: "UPDATE",
    resourceType: "Role",
    resourceId: "role-1",
    tenantId: "tenant-admin",
    invalidates: "perm:role-1",
  },
  {
    name: "deleteRole (custom role)",
    run: () => RolesService.deleteRole("role-1", actor),
    table: "roles",
    action: "DELETE",
    resourceType: "Role",
    resourceId: "role-1",
    tenantId: "tenant-admin",
    invalidates: "perm:role-1",
  },
  {
    name: "deleteRole (system role → deactivate and revoke grants)",
    setup: () => { mockRef.role.is_system = true; },
    run: () => RolesService.deleteRole("role-1", actor),
    table: "role_menu_permissions",
    action: "DELETE",
    resourceType: "Role",
    resourceId: "role-1",
    tenantId: "tenant-admin",
    invalidates: "perm:role-1",
  },
  {
    name: "assignMenuToRole (new grant)",
    run: () => RolesService.assignMenuToRole("role-1", "menu-1", "write", actor),
    table: "role_menu_permissions",
    action: "UPDATE",
    resourceType: "Role",
    resourceId: "role-1",
    tenantId: "tenant-admin",
    invalidates: "perm:role-1",
  },
  {
    name: "assignMenuToRole (changed grant)",
    setup: () => { mockRef.grant = mockRow("role_menu_permissions", { id: "g-1", permissionType: "read" }); },
    run: () => RolesService.assignMenuToRole("role-1", "menu-1", "write", actor),
    table: "role_menu_permissions",
    action: "UPDATE",
    resourceType: "Role",
    resourceId: "role-1",
    tenantId: "tenant-admin",
    invalidates: "perm:role-1",
  },
  {
    name: "removeMenuFromRole",
    run: () => RolesService.removeMenuFromRole("role-1", "menu-1", actor),
    table: "role_menu_permissions",
    action: "UPDATE",
    resourceType: "Role",
    resourceId: "role-1",
    tenantId: "tenant-admin",
    invalidates: "perm:role-1",
  },
  {
    name: "assignRoleToUser",
    run: () => RolesService.assignRoleToUser("user-9", "role-1", actor),
    table: "users",
    action: "UPDATE",
    resourceType: "User",
    resourceId: "user-9",
    tenantId: "tenant-user",
  },
  {
    name: "removeRoleFromUser",
    run: () => RolesService.removeRoleFromUser("user-9", actor),
    table: "users",
    action: "UPDATE",
    resourceType: "User",
    resourceId: "user-9",
    tenantId: "tenant-user",
  },
  {
    name: "setUserPermission",
    run: () => userPermissionService.setUserPermission("user-9", "menu-1", "none", "admin-1", "revoked", actor),
    table: "user_menu_permissions",
    action: "UPDATE",
    resourceType: "User",
    resourceId: "user-9",
    tenantId: "tenant-user",
    invalidates: "uperm:user-9",
  },
  {
    name: "setUserPermission (changed override)",
    setup: () => { mockRef.grant = mockRow("user_menu_permissions", { id: "o-1", permissionType: "read" }); },
    run: () => userPermissionService.setUserPermission("user-9", "menu-1", "write", "admin-1", null, actor),
    table: "user_menu_permissions",
    action: "UPDATE",
    resourceType: "User",
    resourceId: "user-9",
    tenantId: "tenant-user",
    invalidates: "uperm:user-9",
  },
  {
    name: "removeUserPermission",
    run: () => userPermissionService.removeUserPermission("user-9", "menu-1", actor),
    table: "user_menu_permissions",
    action: "UPDATE",
    resourceType: "User",
    resourceId: "user-9",
    tenantId: "tenant-user",
    invalidates: "uperm:user-9",
  },
];

describe("A-41 — role and permission changes audit inside their transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.role = mockRow("roles", { id: "role-1", name: "Tech", status: "active", is_system: false });
    mockRef.user = mockRow("users", { id: "user-9", tenantId: "tenant-user", role_id: "role-0" });
    mockRef.grant = null;
    mockRef.removed = 1;
    redis.del.mockClear();
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ setup, run, table, action, resourceType, resourceId, tenantId, invalidates }) => {
    beforeEach(() => {
      if (setup) {setup();}
    });

    it("commits the change with exactly one valid audit row, under the right tenant, naming the actor", async () => {
      await run();

      expect(mockRef.ledger.committed(table).length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId,
          userId: "admin-1",
          action,
          resourceType,
          resourceId,
          ipAddress: "10.0.0.1",
          userAgent: "UA",
          changes: expect.objectContaining({
            operation: expect.any(String),
            before: expect.any(Object),
            after: expect.any(Object),
          }),
        }),
      ]);
      if (invalidates) {expect(redis.del).toHaveBeenCalledWith(invalidates);}
    });

    it("a failing audit insert rolls the change back, and the cache is left alone", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed(table)).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it("a rolled-back change leaves no audit row", async () => {
      mockRef.ledger.failNext(table, new Error("write failed"));

      await expect(run()).rejects.toThrow("write failed");

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });
  });

  it("removing a grant that did not exist changes nothing and writes no audit row", async () => {
    mockRef.removed = 0;

    await RolesService.removeMenuFromRole("role-1", "menu-1", actor);
    await userPermissionService.removeUserPermission("user-9", "menu-1", actor);

    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a user override for a user that no longer exists is recorded under the actor's tenant", async () => {
    mockRef.user = null;

    await userPermissionService.removeUserPermission("user-gone", "menu-1", actor);

    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ tenantId: "tenant-admin", resourceId: "user-gone" }),
    ]);
  });

  it("a user with no tenant is recorded under the actor's tenant", async () => {
    mockRef.user.tenantId = null;

    await RolesService.assignRoleToUser("user-9", "role-1", actor);

    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ tenantId: "tenant-admin", resourceId: "user-9" }),
    ]);
  });

  it("with no resolvable tenant the change is refused, not committed unattributed (BR-A41-4, fail-closed)", async () => {
    await expect(RolesService.createRole({ name: "Ghost" }, {})).rejects.toThrow(/tenantId cannot be null/);

    expect(mockRef.ledger.committed("roles")).toEqual([]);
  });
});
