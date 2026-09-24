const { Op } = require("sequelize");

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: {
    permissions: jest.fn((id) => `permissions:role:${id}`),
  },
}));

jest.mock("../../models", () => {
  return {
    Role: {
      create: jest.fn(),
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAndCountAll: jest.fn(),
      update: jest.fn(),
      destroy: jest.fn(),
    },
    RoleMenuPermission: {
      findOrCreate: jest.fn(),
      destroy: jest.fn(),
      findAll: jest.fn(),
    },
    MenuGroup: {
      findByPk: jest.fn(),
      findAndCountAll: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
    },
    User: {
      findByPk: jest.fn(),
    },
  };
});

const RolesService = require("../../services/roles.service");
const { Role: mockRole, RoleMenuPermission: mockRoleMenuPermission, MenuGroup: mockMenuGroup, User: mockUser } = require("../../models");

describe("RolesService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createRole", () => {
    it("should create a new role", async () => {
      mockRole.create.mockResolvedValue({ id: "role1", name: "Admin" });
      const result = await RolesService.createRole({ name: " Admin ", description: " Desc ", is_system: true, roleLevel: 6 });
      expect(mockRole.create).toHaveBeenCalledWith({
        name: "Admin",
        description: "Desc",
        is_system: true,
        roleLevel: 6,
        status: "active",
      });
      expect(result.id).toBe("role1");
    });

    it("should default is_system to false and tolerate a missing description", async () => {
      mockRole.create.mockResolvedValue({ id: "role2" });
      await RolesService.createRole({ name: " Viewer " });
      expect(mockRole.create).toHaveBeenCalledWith({
        name: "Viewer",
        description: undefined,
        is_system: false,
        // ADR-043: a role with no level fails every privileged gate silently,
        // so an unspecified level is persisted as the model default, not left out.
        roleLevel: 1,
        status: "active",
      });
    });

    // ADR-043 — the cap is the reason this parameter exists. Level 10 is the
    // SUPER_ADMIN tier, which bypasses rbac() AND tenant scoping; a role minted
    // through a tenant-facing API must never reach it.
    it("caps a tenant-created role at the TENANT_ADMIN tier, never SUPER_ADMIN", async () => {
      mockRole.create.mockResolvedValue({ id: "role3" });
      await RolesService.createRole({ name: "Sneaky", roleLevel: 10 });
      expect(mockRole.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleLevel: 8 }),
      );
    });

    it("floors a level below 1", async () => {
      mockRole.create.mockResolvedValue({ id: "role4" });
      await RolesService.createRole({ name: "Negative", roleLevel: -3 });
      expect(mockRole.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleLevel: 1 }),
      );
    });

    it("ignores a non-integer level", async () => {
      mockRole.create.mockResolvedValue({ id: "role5" });
      await RolesService.createRole({ name: "Fuzzy", roleLevel: "8" });
      expect(mockRole.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleLevel: 1 }),
      );
    });
  });

  describe("getRoleById", () => {
    it("should get a role by id", async () => {
      mockRole.findByPk.mockResolvedValue({ id: "role1" });
      const result = await RolesService.getRoleById("role1");
      expect(mockRole.findByPk).toHaveBeenCalledWith("role1", expect.any(Object));
      expect(result.id).toBe("role1");
    });
  });

  describe("getRoleByName", () => {
    it("should get role by name", async () => {
      mockRole.findOne.mockResolvedValue({ id: "role1", name: "Admin" });
      const result = await RolesService.getRoleByName("Admin");
      expect(mockRole.findOne).toHaveBeenCalledWith({ where: { name: "Admin" } });
      expect(result.id).toBe("role1");
    });
  });

  describe("getAllRoles", () => {
    it("should get all roles with pagination and filters", async () => {
      mockRole.findAndCountAll.mockResolvedValue({ rows: [{ id: "role1" }], count: 1 });
      const result = await RolesService.getAllRoles({
        status: "active",
        is_system: true,
        search: "Admin",
        limit: 10,
        offset: 0,
      });
      expect(mockRole.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          status: "active",
          is_system: true,
          [Op.or]: [
            { name: { [Op.iLike]: "%Admin%" } },
            { description: { [Op.iLike]: "%Admin%" } },
          ],
        },
        limit: 10,
        offset: 0,
      }));
      expect(result.data.length).toBe(1);
      expect(result.count).toBe(1);
      expect(result.page).toBe(1);
    });

    it("should handle default arguments", async () => {
      mockRole.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      await RolesService.getAllRoles();
      expect(mockRole.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
        where: {},
        limit: 100,
        offset: 0,
      }));
    });
  });

  describe("updateRole", () => {
    it("should throw 404 if role not found", async () => {
      mockRole.findByPk.mockResolvedValue(null);
      await expect(RolesService.updateRole("nonexistent", {})).rejects.toThrow("Role not found");
    });

    it("should throw 403 if trying to delete system role", async () => {
      mockRole.findByPk.mockResolvedValue({ is_system: true });
      await expect(RolesService.updateRole("system", { status: "deleted" })).rejects.toThrow("System roles cannot be deleted");
    });

    it("should update role fields", async () => {
      const mockUpdate = jest.fn();
      mockRole.findByPk.mockResolvedValue({ is_system: false, update: mockUpdate });
      await RolesService.updateRole("role1", { name: " NewName ", description: " NewDesc ", status: "inactive" });
      expect(mockUpdate).toHaveBeenCalledWith({
        name: "NewName",
        description: "NewDesc",
        status: "inactive",
      });
    });

    it("should update nothing when no fields are supplied", async () => {
      const mockUpdate = jest.fn();
      mockRole.findByPk.mockResolvedValue({ is_system: false, update: mockUpdate });
      await RolesService.updateRole("role1", {});
      expect(mockUpdate).toHaveBeenCalledWith({});
    });

    it("should allow a system role to be updated to a non-deleted status", async () => {
      const mockUpdate = jest.fn();
      mockRole.findByPk.mockResolvedValue({ is_system: true, update: mockUpdate });
      await RolesService.updateRole("sys1", { status: "inactive" });
      expect(mockUpdate).toHaveBeenCalledWith({ status: "inactive" });
    });
  });

  describe("deleteRole", () => {
    it("should throw 404 if role not found", async () => {
      mockRole.findByPk.mockResolvedValue(null);
      await expect(RolesService.deleteRole("nonexistent")).rejects.toThrow("Role not found");
    });

    it("should deactivate system role instead of deleting", async () => {
      const mockUpdate = jest.fn();
      mockRole.findByPk.mockResolvedValue({ is_system: true, update: mockUpdate, id: "sys1" });
      const result = await RolesService.deleteRole("sys1");
      expect(mockUpdate).toHaveBeenCalledWith({ status: "inactive" });
      expect(mockRoleMenuPermission.destroy).toHaveBeenCalledWith({ where: { roleId: "sys1" } });
      expect(result.message).toBe("System role deactivated");
    });

    it("should destroy regular role", async () => {
      const mockDestroy = jest.fn();
      mockRole.findByPk.mockResolvedValue({ is_system: false, destroy: mockDestroy, id: "reg1" });
      const result = await RolesService.deleteRole("reg1");
      expect(mockDestroy).toHaveBeenCalled();
      expect(result.message).toBe("Role deleted successfully");
    });
  });

  describe("assignMenuToRole", () => {
    it("should throw 404 if role not found", async () => {
      mockRole.findByPk.mockResolvedValue(null);
      await expect(RolesService.assignMenuToRole("r1", "m1")).rejects.toThrow("Role not found");
    });

    it("should throw 404 if menu not found", async () => {
      mockRole.findByPk.mockResolvedValue({});
      mockMenuGroup.findByPk.mockResolvedValue(null);
      await expect(RolesService.assignMenuToRole("r1", "m1")).rejects.toThrow("Menu group not found");
    });

    it("should create new permission if not exists", async () => {
      mockRole.findByPk.mockResolvedValue({});
      mockMenuGroup.findByPk.mockResolvedValue({});
      const mockPerm = { update: jest.fn() };
      mockRoleMenuPermission.findOrCreate.mockResolvedValue([mockPerm, true]);
      await RolesService.assignMenuToRole("r1", "m1", "write");
      expect(mockPerm.update).not.toHaveBeenCalled();
      expect(require("../../services/redis.service").del).toHaveBeenCalledWith("permissions:role:r1");
    });

    it("should update permission if already exists", async () => {
      mockRole.findByPk.mockResolvedValue({});
      mockMenuGroup.findByPk.mockResolvedValue({});
      const mockPerm = { update: jest.fn() };
      mockRoleMenuPermission.findOrCreate.mockResolvedValue([mockPerm, false]);
      await RolesService.assignMenuToRole("r1", "m1", "read");
      expect(mockPerm.update).toHaveBeenCalledWith({ permissionType: "read" });
    });
  });

  describe("removeMenuFromRole", () => {
    it("should delete permission and clear cache", async () => {
      await RolesService.removeMenuFromRole("r1", "m1");
      expect(mockRoleMenuPermission.destroy).toHaveBeenCalledWith({ where: { roleId: "r1", menuGroupId: "m1" } });
      expect(require("../../services/redis.service").del).toHaveBeenCalledWith("permissions:role:r1");
    });
  });

  describe("getRoleMenus", () => {
    it("should return formatted menus", async () => {
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { slug: "dashboard" }, permission_type: "read" },
      ]);
      const result = await RolesService.getRoleMenus("r1");
      expect(result[0].menu.slug).toBe("dashboard");
      expect(result[0].permission_type).toBe("read");
    });
  });

  describe("hasPermission", () => {
    it("should return false if user not found", async () => {
      mockUser.findByPk.mockResolvedValue(null);
      const res = await RolesService.hasPermission("u1", "dash");
      expect(res).toBe(false);
    });

    it("should return false if role inactive", async () => {
      mockUser.findByPk.mockResolvedValue({ role: { status: "inactive" } });
      const res = await RolesService.hasPermission("u1", "dash");
      expect(res).toBe(false);
    });

    it("should return false if no permissions array", async () => {
      mockUser.findByPk.mockResolvedValue({ role: { status: "active", permissions: [] } });
      const res = await RolesService.hasPermission("u1", "dash");
      expect(res).toBe(false);
    });

    it("should return true for read if type is read", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: {
          status: "active",
          permissions: [{ permission_type: "read" }],
        },
      });
      const res = await RolesService.hasPermission("u1", "dash", "read");
      expect(res).toBe(true);
    });

    it("should return true for read if type is write", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: {
          status: "active",
          permissions: [{ permission_type: "write" }],
        },
      });
      const res = await RolesService.hasPermission("u1", "dash", "read");
      expect(res).toBe(true);
    });

    it("should return false for write if type is read", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: {
          status: "active",
          permissions: [{ permission_type: "read" }],
        },
      });
      const res = await RolesService.hasPermission("u1", "dash", "write");
      expect(res).toBe(false);
    });

    it("should return true for write if type is write", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: {
          status: "active",
          permissions: [{ permission_type: "write" }],
        },
      });
      const res = await RolesService.hasPermission("u1", "dash", "write");
      expect(res).toBe(true);
    });

    it("should check parent permission if menu group has parentId", async () => {
      mockMenuGroup.findOne.mockResolvedValue({ parentId: "parent-uuid" });
      mockMenuGroup.findByPk.mockResolvedValue({ slug: "parent-slug" });
      mockUser.findByPk.mockResolvedValue({
        role: {
          status: "active",
          permissions: [{ permission_type: "read" }],
        },
      });

      const res = await RolesService.hasPermission("u1", "child-slug", "read");
      expect(res).toBe(true);
      expect(mockMenuGroup.findOne).toHaveBeenCalledWith({ where: { slug: "child-slug" } });
      expect(mockMenuGroup.findByPk).toHaveBeenCalledWith("parent-uuid");
    });

    it("should check only the menu's own slug when the parent row is missing or has no slug", async () => {
      mockMenuGroup.findOne.mockResolvedValue({ parentId: "parent-uuid" });
      mockMenuGroup.findByPk.mockResolvedValue(null);
      mockUser.findByPk.mockResolvedValue({
        role: { status: "active", permissions: [{ permission_type: "read" }] },
      });

      expect(await RolesService.hasPermission("u1", "child-slug", "read")).toBe(true);
      // Only the requested slug is used when no parent slug can be resolved.
      expect(mockUser.findByPk.mock.calls[0][1].include[0].include[0].include[0].where).toEqual({
        slug: { [Op.in]: ["child-slug"] },
      });

      mockUser.findByPk.mockClear();
      mockMenuGroup.findByPk.mockResolvedValue({ slug: null });
      expect(await RolesService.hasPermission("u1", "child-slug", "read")).toBe(true);
      expect(mockUser.findByPk.mock.calls[0][1].include[0].include[0].include[0].where).toEqual({
        slug: { [Op.in]: ["child-slug"] },
      });
    });

    it("should fall back safely when the menu lookup throws", async () => {
      mockMenuGroup.findOne.mockRejectedValue(new Error("db down"));
      mockUser.findByPk.mockResolvedValue({
        role: { status: "active", permissions: [{ permission_type: "write" }] },
      });

      expect(await RolesService.hasPermission("u1", "dash", "write")).toBe(true);
      expect(mockUser.findByPk.mock.calls[0][1].include[0].include[0].include[0].where).toEqual({
        slug: { [Op.in]: ["dash"] },
      });
    });

    it("should not look up a parent when the menu has no parentId", async () => {
      mockMenuGroup.findOne.mockResolvedValue({ parentId: null });
      mockUser.findByPk.mockResolvedValue({
        role: { status: "active", permissions: [{ permission_type: "read" }] },
      });

      expect(await RolesService.hasPermission("u1", "dash")).toBe(true);
      expect(mockMenuGroup.findByPk).not.toHaveBeenCalled();
    });

    it("should prefer the camelCase permissionType field when present", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: { status: "active", permissions: [{ permissionType: "write" }] },
      });
      expect(await RolesService.hasPermission("u1", "dash", "write")).toBe(true);
    });

    it("should return false for an unrecognised permission type", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: { status: "active", permissions: [{ permission_type: "none" }] },
      });
      expect(await RolesService.hasPermission("u1", "dash", "read")).toBe(false);
    });

    it("should return false when the role has no permissions array at all", async () => {
      mockUser.findByPk.mockResolvedValue({ role: { status: "active" } });
      expect(await RolesService.hasPermission("u1", "dash")).toBe(false);
    });
  });

  describe("getRolePermissionsMatrix", () => {
    beforeEach(() => {
      // The role exists and is active unless a test says otherwise.
      mockRole.findByPk.mockResolvedValue({ id: "r", status: "active" });
    });

    it("grants nothing for a role that no longer exists, and does not cache that", async () => {
      const redis = require("../../services/redis.service");
      redis.get.mockResolvedValue(null);
      mockRole.findByPk.mockResolvedValue(null);
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "Dashboard", slug: "dash" }, permissionType: "write" },
      ]);

      await expect(RolesService.getRolePermissionsMatrix("gone")).resolves.toEqual({});
      expect(mockRole.findByPk).toHaveBeenCalledWith("gone", { attributes: ["id", "status"] });
      expect(mockRoleMenuPermission.findAll).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("grants nothing for an inactive role even though its permission rows remain (W-11)", async () => {
      const redis = require("../../services/redis.service");
      redis.get.mockResolvedValue(null);
      mockRole.findByPk.mockResolvedValue({ id: "r", status: "inactive" });
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "Dashboard", slug: "dash" }, permissionType: "write" },
      ]);

      await expect(RolesService.getRolePermissionsMatrix("r")).resolves.toEqual({});
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("should return cached matrix if available", async () => {
      require("../../services/redis.service").get.mockResolvedValue({ Dashboard: ["read"] });
      const result = await RolesService.getRolePermissionsMatrix("r1");
      expect(result).toEqual({ Dashboard: ["read"] });
    });

    it("should build and cache matrix if not cached", async () => {
      require("../../services/redis.service").get.mockResolvedValue(null);
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "Dashboard", slug: "dash" }, permission_type: "read" },
        { menu: null, permission_type: "read" }, // should skip null menu
      ]);
      const result = await RolesService.getRolePermissionsMatrix("r2");
      expect(result).toEqual({ Dashboard: ["read"], dash: ["read"] });
      expect(require("../../services/redis.service").set).toHaveBeenCalledWith("permissions:role:r2", { Dashboard: ["read"], dash: ["read"] }, 3600);
    });

    it("should inherit permissions for child menu groups in matrix", async () => {
      require("../../services/redis.service").get.mockResolvedValue(null);
      mockRoleMenuPermission.findAll.mockResolvedValue([
        {
          menu: {
            name: "Parent Group",
            slug: "parent-slug",
            children: [
              { name: "Child One", slug: "child-one-slug" },
              { name: "Child Two", slug: "child-two-slug" },
            ],
          },
          permission_type: "write",
        },
      ]);
      const result = await RolesService.getRolePermissionsMatrix("r3");
      expect(result).toEqual({
        "Parent Group": ["write"],
        "parent-slug": ["write"],
        "Child One": ["write"],
        "child-one-slug": ["write"],
        "Child Two": ["write"],
        "child-two-slug": ["write"],
      });
    });

    it("should omit the slug key for a menu that has no slug", async () => {
      require("../../services/redis.service").get.mockResolvedValue(null);
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "Slugless", slug: null, children: [] }, permission_type: "read" },
      ]);
      const result = await RolesService.getRolePermissionsMatrix("r4");
      expect(result).toEqual({ Slugless: ["read"] });
    });

    it("should not duplicate a permission type already recorded for a menu", async () => {
      require("../../services/redis.service").get.mockResolvedValue(null);
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "Dashboard", slug: "dash" }, permissionType: "read" },
        { menu: { name: "Dashboard", slug: "dash" }, permissionType: "read" },
        { menu: { name: "Dashboard", slug: "dash" }, permissionType: "write" },
      ]);
      const result = await RolesService.getRolePermissionsMatrix("r5");
      expect(result).toEqual({ Dashboard: ["read", "write"], dash: ["read", "write"] });
    });

    it("should not duplicate inherited child permissions across parents", async () => {
      require("../../services/redis.service").get.mockResolvedValue(null);
      const child = { name: "Child", slug: "child-slug" };
      const childNoSlug = { name: "Orphan", slug: null };
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "P1", slug: "p1", children: [child, childNoSlug] }, permission_type: "read" },
        { menu: { name: "P2", slug: "p2", children: [child, childNoSlug] }, permission_type: "read" },
      ]);
      const result = await RolesService.getRolePermissionsMatrix("r6");
      expect(result).toEqual({
        P1: ["read"],
        p1: ["read"],
        P2: ["read"],
        p2: ["read"],
        Child: ["read"],
        "child-slug": ["read"],
        Orphan: ["read"],
      });
    });

    it("should skip child inheritance when the children array is empty", async () => {
      require("../../services/redis.service").get.mockResolvedValue(null);
      mockRoleMenuPermission.findAll.mockResolvedValue([
        { menu: { name: "Leaf", slug: "leaf", children: [] }, permission_type: "write" },
      ]);
      const result = await RolesService.getRolePermissionsMatrix("r7");
      expect(result).toEqual({ Leaf: ["write"], leaf: ["write"] });
    });
  });

  // ================================================================
  // W-11 — revoking a role must reach the cached matrix.
  //
  // Redis is an in-memory Map here so the cache has state: a read, a
  // mutation, and the next read. The question each test asks is the one
  // that matters on a gated request: after the mutation, does the next
  // matrix read go to the database, or serve the old grant from cache?
  // ================================================================
  describe("revocation reaches the permission cache (W-11)", () => {
    let store;
    const rows = [{ menu: { name: "Dashboard", slug: "dash" }, permissionType: "write" }];
    const granted = { Dashboard: ["write"], dash: ["write"] };

    beforeEach(() => {
      const redis = require("../../services/redis.service");
      store = new Map();
      redis.get.mockImplementation(async (k) => (store.has(k) ? store.get(k) : null));
      redis.set.mockImplementation(async (k, v) => { store.set(k, v); return true; });
      redis.del.mockImplementation(async (k) => { store.delete(k); return true; });
      mockRoleMenuPermission.findAll.mockResolvedValue(rows);
    });

    afterEach(() => {
      const redis = require("../../services/redis.service");
      redis.get.mockReset();
      redis.set.mockReset();
      redis.del.mockReset();
    });

    /** Prime the cache: the first read builds from the DB, the second is served from cache. */
    const prime = async (roleId, roleRow) => {
      mockRole.findByPk.mockResolvedValue(roleRow);
      await expect(RolesService.getRolePermissionsMatrix(roleId)).resolves.toEqual(granted);
      await expect(RolesService.getRolePermissionsMatrix(roleId)).resolves.toEqual(granted);
      expect(mockRoleMenuPermission.findAll).toHaveBeenCalledTimes(1);
      expect(store.has(`permissions:role:${roleId}`)).toBe(true);
      mockRoleMenuPermission.findAll.mockClear();
      mockRole.findByPk.mockClear();
    };

    it("deleting a regular role: the next matrix read goes to the database and grants nothing", async () => {
      const role = { id: "reg1", is_system: false, status: "active", destroy: jest.fn() };
      await prime("reg1", role);

      await RolesService.deleteRole("reg1");
      expect(store.has("permissions:role:reg1")).toBe(false);

      // Role is paranoid: after destroy() the lookup finds nothing, though
      // the soft delete leaves the RoleMenuPermission rows in place.
      mockRole.findByPk.mockResolvedValue(null);
      await expect(RolesService.getRolePermissionsMatrix("reg1")).resolves.toEqual({});
      expect(mockRole.findByPk).toHaveBeenCalledWith("reg1", { attributes: ["id", "status"] });
    });

    it("deactivating a system role via deleteRole: the next matrix read goes to the database", async () => {
      const role = { id: "sys1", is_system: true, status: "active" };
      role.update = jest.fn(async (u) => Object.assign(role, u));
      await prime("sys1", role);

      await RolesService.deleteRole("sys1");
      expect(store.has("permissions:role:sys1")).toBe(false);

      mockRoleMenuPermission.findAll.mockResolvedValue([]); // rows destroyed
      await expect(RolesService.getRolePermissionsMatrix("sys1")).resolves.toEqual({});
      expect(mockRole.findByPk).toHaveBeenCalledWith("sys1", { attributes: ["id", "status"] });
    });

    it("updateRole to inactive: the next matrix read goes to the database and grants nothing", async () => {
      const role = { id: "r1", is_system: false, status: "active" };
      role.update = jest.fn(async (u) => Object.assign(role, u));
      await prime("r1", role);

      await RolesService.updateRole("r1", { status: "inactive" });
      expect(store.has("permissions:role:r1")).toBe(false);

      // updateRole leaves the permission rows alone; the status alone revokes.
      await expect(RolesService.getRolePermissionsMatrix("r1")).resolves.toEqual({});
      expect(mockRole.findByPk).toHaveBeenCalledWith("r1", { attributes: ["id", "status"] });
    });

    it("updateRole back to active: the grant returns on the next read", async () => {
      const role = { id: "r2", is_system: false, status: "inactive" };
      role.update = jest.fn(async (u) => Object.assign(role, u));
      mockRole.findByPk.mockResolvedValue(role);
      await expect(RolesService.getRolePermissionsMatrix("r2")).resolves.toEqual({});

      await RolesService.updateRole("r2", { status: "active" });
      await expect(RolesService.getRolePermissionsMatrix("r2")).resolves.toEqual(granted);
    });

    it("renaming a role leaves the cached matrix alone", async () => {
      const role = { id: "r3", is_system: false, status: "active" };
      role.update = jest.fn(async (u) => Object.assign(role, u));
      await prime("r3", role);

      await RolesService.updateRole("r3", { name: "Renamed", description: "d" });
      expect(store.has("permissions:role:r3")).toBe(true);
    });
  });

  describe("getUserMenus", () => {
    it("should return empty array if user or role not found", async () => {
      mockUser.findByPk.mockResolvedValue(null);
      expect(await RolesService.getUserMenus("u1")).toEqual([]);
      mockUser.findByPk.mockResolvedValue({});
      expect(await RolesService.getUserMenus("u1")).toEqual([]);
    });

    it("should return formatted menus", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: {
          permissions: [
            { menu: { slug: "dash" }, permission_type: "read" },
            { menu: null }, // should skip
          ],
        },
      });
      const result = await RolesService.getUserMenus("u1");
      expect(result.length).toBe(1);
      expect(result[0].menu.slug).toBe("dash");
    });

    it("should return an empty array when the role has no permissions array", async () => {
      mockUser.findByPk.mockResolvedValue({ role: {} });
      expect(await RolesService.getUserMenus("u1")).toEqual([]);
    });

    it("should prefer the camelCase permissionType field when present", async () => {
      mockUser.findByPk.mockResolvedValue({
        role: { permissions: [{ menu: { slug: "dash" }, permissionType: "write" }] },
      });
      const result = await RolesService.getUserMenus("u1");
      expect(result[0]).toEqual({
        menu: { slug: "dash" },
        permissionType: "write",
        permission_type: "write",
      });
    });
  });

  describe("assignRoleToUser", () => {
    it("should throw 404 if user not found", async () => {
      mockUser.findByPk.mockResolvedValue(null);
      await expect(RolesService.assignRoleToUser("u1", "r1")).rejects.toThrow("User not found");
    });

    it("should throw 404 if role not found", async () => {
      mockUser.findByPk.mockResolvedValue({});
      mockRole.findByPk.mockResolvedValue(null);
      await expect(RolesService.assignRoleToUser("u1", "r1")).rejects.toThrow("Role not found");
    });

    it("should throw 400 if role is inactive", async () => {
      mockUser.findByPk.mockResolvedValue({});
      mockRole.findByPk.mockResolvedValue({ status: "inactive" });
      await expect(RolesService.assignRoleToUser("u1", "r1")).rejects.toThrow("Cannot assign inactive role");
    });

    it("should assign role and save user", async () => {
      const mockSave = jest.fn();
      mockUser.findByPk.mockResolvedValue({ save: mockSave });
      mockRole.findByPk.mockResolvedValue({ status: "active" });
      const res = await RolesService.assignRoleToUser("u1", "r1");
      expect(res.role_id).toBe("r1");
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe("removeRoleFromUser", () => {
    it("should throw 404 if user not found", async () => {
      mockUser.findByPk.mockResolvedValue(null);
      await expect(RolesService.removeRoleFromUser("u1")).rejects.toThrow("User not found");
    });

    it("should set role_id to null and save", async () => {
      const mockSave = jest.fn();
      mockUser.findByPk.mockResolvedValue({ save: mockSave, role_id: "r1" });
      await RolesService.removeRoleFromUser("u1");
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe("Menu Groups Management", () => {
    describe("getAllMenus", () => {
      it("should get all menus with filters", async () => {
        mockMenuGroup.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
        await RolesService.getAllMenus({
          is_active: true,
          search: "Dash",
          limit: 10,
          offset: 0,
        });
        expect(mockMenuGroup.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
          where: {
            is_active: true,
            [Op.or]: [
              { name: { [Op.iLike]: "%Dash%" } },
              { slug: { [Op.iLike]: "%Dash%" } },
            ],
          },
        }));
      });

      it("should handle default arguments", async () => {
        mockMenuGroup.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
        await RolesService.getAllMenus();
        expect(mockMenuGroup.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
          where: {},
          limit: 100,
          offset: 0,
        }));
      });
    });

    describe("getMenuById", () => {
      it("should get menu by id", async () => {
        mockMenuGroup.findByPk.mockResolvedValue({ id: "m1" });
        const res = await RolesService.getMenuById("m1");
        expect(res.id).toBe("m1");
      });
    });

    describe("createMenu", () => {
      it("should create a new menu group", async () => {
        await RolesService.createMenu({ name: " Dash Board " });
        expect(mockMenuGroup.create).toHaveBeenCalledWith({
          name: "Dash Board",
          slug: "dash-board",
          icon: undefined,
          parent_id: undefined,
          sort_order: 0,
          is_active: true,
        });
      });

      it("does not touch the permission cache for a top-level menu", async () => {
        const { delPattern } = require("../../services/redis.service");
        await RolesService.createMenu({ name: "Top" });
        expect(delPattern).not.toHaveBeenCalled();
      });

      it("invalidates every role matrix when the new menu is a child (it inherits its parent's grant)", async () => {
        const { delPattern } = require("../../services/redis.service");
        mockMenuGroup.create.mockResolvedValue({ id: "child" });
        const menu = await RolesService.createMenu({ name: "Child", parent_id: "p1" });
        expect(menu).toEqual({ id: "child" });
        expect(delPattern).toHaveBeenCalledWith("permissions:role:*");
      });

      it("should use provided slug and is_active", async () => {
        await RolesService.createMenu({ name: "Dash", slug: "custom-slug", is_active: false });
        expect(mockMenuGroup.create).toHaveBeenCalledWith(expect.objectContaining({
          slug: "custom-slug",
          is_active: false,
        }));
      });
    });

    describe("updateMenu", () => {
      it("should throw 404 if not found", async () => {
        mockMenuGroup.findByPk.mockResolvedValue(null);
        await expect(RolesService.updateMenu("m1", {})).rejects.toThrow("Menu group not found");
      });

      it("should update and clear cache", async () => {
        const mockUpdate = jest.fn();
        mockMenuGroup.findByPk.mockResolvedValue({ update: mockUpdate });
        await RolesService.updateMenu("m1", { name: " NewName ", is_active: false });
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
          name: "NewName",
          is_active: false,
        }));
        expect(require("../../services/redis.service").delPattern).toHaveBeenCalledWith("permissions:role:*");
      });

      it("should update every supplied field", async () => {
        const mockUpdate = jest.fn();
        mockMenuGroup.findByPk.mockResolvedValue({ update: mockUpdate });

        await RolesService.updateMenu("m1", {
          name: " Reports ",
          slug: " custom-slug ",
          icon: "chart",
          parent_id: "p1",
          sort_order: 5,
          is_active: true,
        });

        expect(mockUpdate).toHaveBeenCalledWith({
          name: "Reports",
          slug: "custom-slug",
          icon: "chart",
          parent_id: "p1",
          sort_order: 5,
          is_active: true,
        });
      });

      it("should derive the slug from the name when slug is supplied but blank", async () => {
        const mockUpdate = jest.fn();
        mockMenuGroup.findByPk.mockResolvedValue({ update: mockUpdate });

        await RolesService.updateMenu("m1", { name: " Dash Board ", slug: "" });

        expect(mockUpdate).toHaveBeenCalledWith({ name: "Dash Board", slug: "dash-board" });
      });

      it("should leave the slug undefined when both slug and name are blank", async () => {
        const mockUpdate = jest.fn();
        mockMenuGroup.findByPk.mockResolvedValue({ update: mockUpdate });

        await RolesService.updateMenu("m1", { slug: null });

        expect(mockUpdate).toHaveBeenCalledWith({ slug: undefined });
      });

      it("should update nothing when no fields are supplied", async () => {
        const mockUpdate = jest.fn();
        mockMenuGroup.findByPk.mockResolvedValue({ update: mockUpdate });

        await RolesService.updateMenu("m1", {});

        expect(mockUpdate).toHaveBeenCalledWith({});
      });
    });

    describe("deleteMenu", () => {
      it("should throw 404 if not found", async () => {
        mockMenuGroup.findByPk.mockResolvedValue(null);
        await expect(RolesService.deleteMenu("m1")).rejects.toThrow("Menu group not found");
      });

      it("should delete, remove permissions, and clear cache", async () => {
        const mockDestroy = jest.fn();
        mockMenuGroup.findByPk.mockResolvedValue({ destroy: mockDestroy });
        await RolesService.deleteMenu("m1");
        expect(mockRoleMenuPermission.destroy).toHaveBeenCalledWith({ where: { menuGroupId: "m1" } });
        expect(mockDestroy).toHaveBeenCalled();
        expect(require("../../services/redis.service").delPattern).toHaveBeenCalledWith("permissions:role:*");
      });
    });
  });
});
