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
      const result = await RolesService.createRole({ name: " Admin ", description: " Desc ", is_system: true });
      expect(mockRole.create).toHaveBeenCalledWith({
        name: "Admin",
        description: "Desc",
        is_system: true,
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
        status: "active",
      });
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
