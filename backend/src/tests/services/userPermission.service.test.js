// eslint-disable-next-line no-undef
jest.mock("../../models", () => {
  const mockUser = {
    findByPk: jest.fn(),
  };
  const mockRole = {
    findAll: jest.fn(),
  };
  const mockMenuGroup = {
    findByPk: jest.fn(),
    findAll: jest.fn(),
  };
  const mockRoleMenuPermission = {
    findAll: jest.fn(),
  };
  const mockUserMenuPermission = {
    findAll: jest.fn(),
    findOrCreate: jest.fn(),
    destroy: jest.fn(),
  };
  return {
    User: mockUser,
    Role: mockRole,
    MenuGroup: mockMenuGroup,
    RoleMenuPermission: mockRoleMenuPermission,
    UserMenuPermission: mockUserMenuPermission,
  };
});
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
  cacheKeys: {
    userPermissions: jest.fn((uid) => `user:perms:${uid}`),
  },
}));
jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));

const {
  getUserPermissions,
  setUserPermission,
  removeUserPermission,
  getUserOverrideMatrix,
} = require("../../services/userPermission.service");

describe("userPermission.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getUserPermissions", () => {
    it("should throw error when user not found", async () => {
      const { User } = require("../../models");
      User.findByPk.mockResolvedValue(null);

      await expect(getUserPermissions("nonexistent")).rejects.toThrow(
        "User not found",
      );
    });

    it("should return user permissions with role and overrides", async () => {
      const { User } = require("../../models");
      const { MenuGroup } = require("../../models");

      User.findByPk.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        tenantId: "tenant-1",
        role: {
          id: "role-1",
          name: "admin",
          nameToShow: "Administrator",
          status: "active",
        },
      });

      MenuGroup.findAll.mockResolvedValue([
        {
          id: "menu-1",
          name: "dashboard",
          slug: "dashboard",
          icon: "home",
          sortOrder: 1,
        },
        {
          id: "menu-2",
          name: "reports",
          slug: "reports",
          icon: "chart",
          sortOrder: 2,
        },
      ]);

      const { RoleMenuPermission, UserMenuPermission } = require("../../models");
      RoleMenuPermission.findAll.mockResolvedValue([
        {
          menuGroupId: "menu-1",
          permissionType: "read",
          menu: {
            id: "menu-1",
            name: "dashboard",
            slug: "dashboard",
            icon: "home",
            parentId: null,
          },
        },
        {
          menuGroupId: "menu-2",
          permissionType: "write",
          menu: {
            id: "menu-2",
            name: "reports",
            slug: "reports",
            icon: "chart",
            parentId: null,
          },
        },
      ]);
      UserMenuPermission.findAll.mockResolvedValue([]);

      const result = await getUserPermissions("user-1");

      expect(result.success).toBe(true);
      expect(result.data.user.id).toBe("user-1");
      expect(result.data.user.role.name).toBe("admin");
      expect(result.data.effective).toHaveLength(2);
      expect(result.data.effective[0].menuGroupId).toBe("menu-1");
      expect(result.data.effective[0].permissionType).toBe("read");
      expect(result.data.effective[0].source).toBe("role");
    });

    it("should apply custom overrides over role permissions", async () => {
      const { User } = require("../../models");
      const { MenuGroup } = require("../../models");
      const { RoleMenuPermission, UserMenuPermission } = require("../../models");

      User.findByPk.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        tenantId: "tenant-1",
        role: {
          id: "role-1",
          name: "admin",
          nameToShow: "Administrator",
          status: "active",
        },
      });

      MenuGroup.findAll.mockResolvedValue([
        {
          id: "menu-1",
          name: "dashboard",
          slug: "dashboard",
          icon: "home",
          sortOrder: 1,
        },
      ]);

      RoleMenuPermission.findAll.mockResolvedValue([
        {
          menuGroupId: "menu-1",
          permissionType: "read",
          menu: {
            id: "menu-1",
            name: "dashboard",
            slug: "dashboard",
            icon: "home",
            parentId: null,
          },
        },
      ]);
      UserMenuPermission.findAll.mockResolvedValue([
        {
          menuGroupId: "menu-1",
          permissionType: "write",
          menu: {
            id: "menu-1",
            name: "dashboard",
            slug: "dashboard",
            icon: "home",
            parentId: null,
          },
        },
      ]);

      const result = await getUserPermissions("user-1");

      expect(result.data.effective[0].permissionType).toBe("write");
      expect(result.data.effective[0].source).toBe("custom");
    });

    it("should revoke access for a 'none' override and null out a missing menu relation", async () => {
      const { User } = require("../../models");
      const { MenuGroup } = require("../../models");
      const { RoleMenuPermission, UserMenuPermission } = require("../../models");

      User.findByPk.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        tenantId: "tenant-1",
        role: {
          id: "role-1",
          name: "admin",
          nameToShow: "Administrator",
          status: "active",
        },
      });

      MenuGroup.findAll.mockResolvedValue([
        {
          id: "menu-1",
          name: "dashboard",
          slug: "dashboard",
          icon: "home",
          sortOrder: 1,
        },
      ]);

      RoleMenuPermission.findAll.mockResolvedValue([
        {
          menuGroupId: "menu-1",
          permissionType: "write",
          menu: { id: "menu-1", name: "dashboard", slug: "dashboard", icon: "home", parentId: null },
        },
      ]);
      // override revokes access, and its menu relation failed to load
      UserMenuPermission.findAll.mockResolvedValue([
        {
          menuGroupId: "menu-1",
          permissionType: "none",
          menu: null,
          notes: "revoked",
        },
      ]);

      const result = await getUserPermissions("user-1");

      // "none" collapses to no access, but still sourced from the custom override
      expect(result.data.effective[0].permissionType).toBeNull();
      expect(result.data.effective[0].source).toBe("custom");
      expect(result.data.effective[0].rolePermission).toBe("write");
      expect(result.data.effective[0].override).toBe("none");
      // formatMenu(null) yields null rather than throwing
      expect(result.data.overrides[0].menu).toBeNull();
    });

    it("should handle user without role", async () => {
      const { User } = require("../../models");
      const { MenuGroup } = require("../../models");

      User.findByPk.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        tenantId: "tenant-1",
        role: null,
      });

      MenuGroup.findAll.mockResolvedValue([
        {
          id: "menu-1",
          name: "dashboard",
          slug: "dashboard",
          icon: "home",
          sortOrder: 1,
        },
      ]);

      const { UserMenuPermission } = require("../../models");
      UserMenuPermission.findAll.mockResolvedValue([]);

      const result = await getUserPermissions("user-1");

      expect(result.data.user.role).toBe(null);
      expect(result.data.effective[0].permissionType).toBe(null);
      expect(result.data.effective[0].source).toBe(null);
    });

    it("should filter out role permissions with null menu", async () => {
      const { User } = require("../../models");
      const { MenuGroup } = require("../../models");
      const { RoleMenuPermission } = require("../../models");

      User.findByPk.mockResolvedValue({
        id: "user-1",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        tenantId: "tenant-1",
        role: {
          id: "role-1",
          name: "admin",
          nameToShow: "Admin",
          status: "active",
        },
      });

      MenuGroup.findAll.mockResolvedValue([
        {
          id: "menu-1",
          name: "dashboard",
          slug: "dashboard",
          icon: "home",
          sortOrder: 1,
        },
      ]);

      RoleMenuPermission.findAll.mockResolvedValue([
        {
          menuGroupId: "menu-1",
          permissionType: "read",
          menu: null,
        },
      ]);
      const { UserMenuPermission } = require("../../models");
      UserMenuPermission.findAll.mockResolvedValue([]);

      const result = await getUserPermissions("user-1");

      expect(result.data.rolePermissions).toHaveLength(0);
      expect(result.data.effective[0].permissionType).toBe(null);
    });
  });

  describe("setUserPermission", () => {
    it("should throw error for invalid permission type", async () => {
      const { User, MenuGroup } = require("../../models");
      User.findByPk.mockResolvedValue({ id: "user-1" });
      MenuGroup.findByPk.mockResolvedValue({ id: "menu-1" });

      await expect(
        setUserPermission("user-1", "menu-1", "invalid"),
      ).rejects.toThrow("permissionType must be one of: read, write, none");
    });

    it("should throw error when user not found", async () => {
      const { User, MenuGroup } = require("../../models");
      User.findByPk.mockResolvedValue(null);

      await expect(
        setUserPermission("nonexistent", "menu-1", "read"),
      ).rejects.toThrow("User not found");
    });

    it("should throw error when menu not found", async () => {
      const { User, MenuGroup } = require("../../models");
      User.findByPk.mockResolvedValue({ id: "user-1" });
      MenuGroup.findByPk.mockResolvedValue(null);

      await expect(
        setUserPermission("user-1", "nonexistent", "read"),
      ).rejects.toThrow("Menu group not found");
    });

    it("should create new permission override", async () => {
      const { User, MenuGroup } = require("../../models");
      User.findByPk.mockResolvedValue({ id: "user-1" });
      MenuGroup.findByPk.mockResolvedValue({ id: "menu-1" });

      const { UserMenuPermission } = require("../../models");
      UserMenuPermission.findOrCreate.mockResolvedValue([
        {
          id: "perm-1",
          userId: "user-1",
          menuGroupId: "menu-1",
          permissionType: "read",
          grantedBy: "admin-1",
          notes: "Test override",
        },
        true,
      ]);

      const result = await setUserPermission(
        "user-1",
        "menu-1",
        "read",
        "admin-1",
        "Test override",
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(result.message).toBe("Custom permission assigned successfully");
    });

    it("should update existing permission override", async () => {
      const { User, MenuGroup } = require("../../models");
      User.findByPk.mockResolvedValue({ id: "user-1" });
      MenuGroup.findByPk.mockResolvedValue({ id: "menu-1" });

      const { UserMenuPermission } = require("../../models");
      const existingPerm = {
        id: "perm-1",
        userId: "user-1",
        menuGroupId: "menu-1",
        permissionType: "read",
        update: jest.fn().mockResolvedValue(true),
      };
      UserMenuPermission.findOrCreate.mockResolvedValue([existingPerm, false]);

      const result = await setUserPermission(
        "user-1",
        "menu-1",
        "write",
        "admin-1",
        "Updated override",
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe("Custom permission updated successfully");
      expect(existingPerm.update).toHaveBeenCalledWith({
        permissionType: "write",
        grantedBy: "admin-1",
        notes: "Updated override",
      });
    });

    it("should invalidate cache after setting permission", async () => {
      const { User, MenuGroup } = require("../../models");
      User.findByPk.mockResolvedValue({ id: "user-1" });
      MenuGroup.findByPk.mockResolvedValue({ id: "menu-1" });

      const { UserMenuPermission } = require("../../models");
      UserMenuPermission.findOrCreate.mockResolvedValue([
        {
          id: "perm-1",
          userId: "user-1",
          menuGroupId: "menu-1",
          permissionType: "read",
        },
        true,
      ]);

      await setUserPermission("user-1", "menu-1", "read");

      const { del, cacheKeys } = require("../../services/redis.service");
      expect(del).toHaveBeenCalledWith("user:perms:user-1");
    });
  });

  describe("removeUserPermission", () => {
    it("should remove permission override and invalidate cache", async () => {
      const { UserMenuPermission } = require("../../models");
      UserMenuPermission.destroy.mockResolvedValue(1);

      const result = await removeUserPermission("user-1", "menu-1");

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        "Custom permission removed — role inheritance restored",
      );
      expect(result.data).toBeNull();
      expect(UserMenuPermission.destroy).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          menuGroupId: "menu-1",
        },
      });
    });
  });

  describe("getUserOverrideMatrix", () => {
    it("should return cached matrix when available", async () => {
      const { get } = require("../../services/redis.service");
      get.mockResolvedValueOnce({ dashboard: "read", reports: "write" });

      const result = await getUserOverrideMatrix("user-1");

      expect(result).toEqual({ dashboard: "read", reports: "write" });
    });

    it("should fetch and cache matrix when not cached", async () => {
      const { get, set } = require("../../services/redis.service");
      get.mockResolvedValueOnce(null);

      const { UserMenuPermission, MenuGroup } = require("../../models");
      UserMenuPermission.findAll.mockResolvedValue([
        {
          menu: { name: "dashboard" },
          permissionType: "read",
        },
        {
          menu: { name: "reports" },
          permissionType: "write",
        },
      ]);

      const result = await getUserOverrideMatrix("user-1");

      expect(result).toEqual({ dashboard: "read", reports: "write" });
      expect(set).toHaveBeenCalledWith("user:perms:user-1", result, 300);
    });

    it("should skip entries without menu name", async () => {
      const { get } = require("../../services/redis.service");
      get.mockResolvedValueOnce(null);

      const { UserMenuPermission } = require("../../models");
      UserMenuPermission.findAll.mockResolvedValue([
        {
          menu: null,
          permissionType: "read",
        },
        {
          menu: { name: "dashboard" },
          permissionType: "write",
        },
      ]);

      const result = await getUserOverrideMatrix("user-1");

      expect(result).toEqual({ dashboard: "write" });
    });
  });
});
