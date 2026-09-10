/**
 * Tests for seedMenuGroups utility
 *
 * Covers: getMenuGroupId, seedMenuGroups, seedRoleMenuPermissions, seedAll
 */

jest.mock("../../models", () => ({
  MenuGroup: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  RoleMenuPermission: {
    destroy: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  Roles: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { MenuGroup, RoleMenuPermission, Roles } = require("../../models");
const {
  seedMenuGroups,
  seedRoleMenuPermissions,
  seedAll,
  getMenuGroupId,
} = require("../../utils/seedMenuGroups.util");

describe("seedMenuGroups utility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MenuGroup.findAll.mockResolvedValue([]);
    
    const parentSlugs = ["home", "dashboard", "account", "management", "equipment", "security", "warehouse", "mgmt-organization", "mgmt-work", "mgmt-quality", "mgmt-finance", "mgmt-partners", "mgmt-developer", "mgmt-content"];
    MenuGroup.findOne.mockImplementation((query) => {
      const slug = query && query.where && query.where.slug;
      if (slug && parentSlugs.includes(slug)) {
        return Promise.resolve({ id: "parent-id", update: jest.fn().mockResolvedValue(undefined) });
      }
      return Promise.resolve(null);
    });

    MenuGroup.create.mockResolvedValue({ id: "mg-1" });
    RoleMenuPermission.destroy.mockResolvedValue(0);
    RoleMenuPermission.findOne.mockResolvedValue(null);
    RoleMenuPermission.create.mockResolvedValue({ id: "rmp-1" });
    Roles.findOne.mockResolvedValue({ id: "role-1" });
  });

  describe("seedMenuGroups", () => {
    it("should seed parent menu groups successfully", async () => {
      const parentSlugs = ["home", "dashboard", "account", "management", "equipment", "security", "warehouse", "mgmt-organization", "mgmt-work", "mgmt-quality", "mgmt-finance", "mgmt-partners", "mgmt-developer", "mgmt-content"];
      let callCount = 0;
      MenuGroup.findOne.mockImplementation((query) => {
        callCount++;
        const slug = query && query.where && query.where.slug;
        if (callCount <= 7) return Promise.resolve(null);
        if (slug && parentSlugs.includes(slug)) {
          return Promise.resolve({ id: "parent-id", update: jest.fn().mockResolvedValue(undefined) });
        }
        return Promise.resolve(null);
      });

      await seedMenuGroups();

      expect(MenuGroup.create).toHaveBeenCalled();
      expect(MenuGroup.findOne).toHaveBeenCalled();
    });

    it("should seed child menu groups with parent references", async () => {
      const parentSlugs = ["home", "dashboard", "account", "management", "equipment", "security", "warehouse", "mgmt-organization", "mgmt-work", "mgmt-quality", "mgmt-finance", "mgmt-partners", "mgmt-developer", "mgmt-content"];
      MenuGroup.findOne.mockImplementation((query) => {
        const slug = query && query.where && query.where.slug;
        if (slug && parentSlugs.includes(slug)) {
          return Promise.resolve({ id: "parent-id", update: jest.fn().mockResolvedValue(undefined) });
        }
        return Promise.resolve(null);
      });

      MenuGroup.create.mockResolvedValue({ id: "child-1" });

      await seedMenuGroups();

      expect(MenuGroup.findOne).toHaveBeenCalled();
    });

    it("should update existing menu groups instead of creating duplicates", async () => {
      const existingGroup = {
        id: "mg-1",
        update: jest.fn().mockResolvedValue(undefined),
      };
      MenuGroup.findOne.mockResolvedValue(existingGroup);

      await seedMenuGroups();

      expect(existingGroup.update).toHaveBeenCalled();
      expect(MenuGroup.create).not.toHaveBeenCalled();
    });

    it("should remove deprecated menu groups", async () => {
      const deprecatedGroup = {
        id: "deprecated-1",
        name: "Table Permission",
        slug: "table-permission",
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      MenuGroup.findAll.mockResolvedValue([deprecatedGroup]);

      const parentSlugs = ["home", "dashboard", "account", "management", "equipment", "security", "warehouse", "mgmt-organization", "mgmt-work", "mgmt-quality", "mgmt-finance", "mgmt-partners", "mgmt-developer", "mgmt-content"];
      MenuGroup.findOne.mockImplementation((query) => {
        const slug = query && query.where && query.where.slug;
        if (slug && parentSlugs.includes(slug)) {
          return Promise.resolve({ id: "parent-id", update: jest.fn().mockResolvedValue(undefined) });
        }
        return Promise.resolve(null);
      });

      await seedMenuGroups();

      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({
        where: { menuGroupId: "deprecated-1" },
      });
      expect(deprecatedGroup.destroy).toHaveBeenCalled();
    });

    it("should retry creation when fixed ID fails", async () => {
      const parentSlugs = ["home", "dashboard", "account", "management", "equipment", "security", "warehouse", "mgmt-organization", "mgmt-work", "mgmt-quality", "mgmt-finance", "mgmt-partners", "mgmt-developer", "mgmt-content"];
      let callCount = 0;
      MenuGroup.findOne.mockImplementation((query) => {
        callCount++;
        const slug = query && query.where && query.where.slug;
        if (callCount <= 7) return Promise.resolve(null);
        if (slug && parentSlugs.includes(slug)) {
          return Promise.resolve({ id: "parent-id", update: jest.fn().mockResolvedValue(undefined) });
        }
        return Promise.resolve(null);
      });
      MenuGroup.create
        .mockRejectedValueOnce(new Error("Unique constraint violation"))
        .mockResolvedValueOnce({ id: "mg-2" });

      await seedMenuGroups();

      expect(MenuGroup.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: expect.any(String) }));
      expect(MenuGroup.create).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ id: expect.any(String) }));
    });

    it("should throw error when menu items fail to seed", async () => {
      MenuGroup.findOne.mockResolvedValue(null);
      MenuGroup.create.mockRejectedValue(new Error("DB error"));

      await expect(seedMenuGroups()).rejects.toThrow("Menu seeding issues");
    });

    it("should handle error with errors array in describeError when deprecated group fails to destroy", async () => {
      const deprecatedGroup = {
        id: "deprecated-1",
        name: "Table Permission",
        slug: "table-permission",
        destroy: jest.fn().mockRejectedValue({
          message: "Destroy failed",
          errors: [{ path: "id", message: "Foreign key constraint" }]
        }),
      };
      MenuGroup.findAll.mockResolvedValue([deprecatedGroup]);

      await expect(seedMenuGroups()).rejects.toThrow("Destroy failed (id: Foreign key constraint)");
    });

    it("should handle child menu group seeding failure", async () => {
      const parentSlugs = ["home", "dashboard", "account", "management", "equipment", "security", "warehouse", "mgmt-organization", "mgmt-work", "mgmt-quality", "mgmt-finance", "mgmt-partners", "mgmt-developer", "mgmt-content"];
      MenuGroup.findOne.mockImplementation((query) => {
        const slug = query && query.where && query.where.slug;
        if (slug === "equipment") {
          return Promise.resolve({ id: "parent-id", update: jest.fn().mockResolvedValue(undefined) });
        }
        if (slug && !parentSlugs.includes(slug)) {
          return Promise.reject(new Error("Child DB error"));
        }
        return Promise.resolve(null);
      });

      await expect(seedMenuGroups()).rejects.toThrow("Child DB error");
    });
  });

  describe("seedRoleMenuPermissions", () => {
    it("should assign permissions to SUPERADMIN role", async () => {
      Roles.findOne.mockResolvedValue({ id: "superadmin-role" });
      MenuGroup.findOne.mockResolvedValue({ id: "mg-1" });

      await seedRoleMenuPermissions();

      expect(Roles.findOne).toHaveBeenCalledWith({
        where: { name: "SUPERADMIN" },
      });
      expect(RoleMenuPermission.create).toHaveBeenCalled();
    });

    it("should skip roles that are not found", async () => {
      Roles.findOne.mockResolvedValue(null);

      await seedRoleMenuPermissions();

      // Should not throw, just log warning
      expect(RoleMenuPermission.create).not.toHaveBeenCalled();
    });

    it("should skip menu groups that are not found", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue(null);

      await seedRoleMenuPermissions();

      // Should not throw, just log warning
      expect(RoleMenuPermission.create).not.toHaveBeenCalled();
    });

    it("should not create duplicate permissions", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-1" });
      MenuGroup.findOne.mockResolvedValue({ id: "mg-1" });
      RoleMenuPermission.findOne.mockResolvedValue({ id: "existing" });

      await seedRoleMenuPermissions();

      expect(RoleMenuPermission.create).not.toHaveBeenCalled();
    });

    it("should assign different permissions to different roles", async () => {
      const mockRole = (name) => ({ id: `role-${name}` });
      const mockGroup = () => ({ id: "mg-1" });

      Roles.findOne.mockImplementation((query) => {
        if (query.where.name === "SUPERADMIN") return mockRole("superadmin");
        if (query.where.name === "USER") return mockRole("user");
        return null;
      });

      MenuGroup.findOne.mockResolvedValue(mockGroup());
      RoleMenuPermission.findOne.mockResolvedValue(null);

      await seedRoleMenuPermissions();

      expect(RoleMenuPermission.create).toHaveBeenCalled();
    });
  });

  describe("seedAll", () => {
    it("should seed both menu groups and role permissions", async () => {
      Roles.findOne.mockResolvedValue({ id: "role-1" });

      await seedAll();

      expect(MenuGroup.create).toHaveBeenCalled();
      expect(RoleMenuPermission.create).toHaveBeenCalled();
    });
  });

  describe("getMenuGroupId", () => {
    it("should generate a fallback UUID for unknown slugs", () => {
      const id = getMenuGroupId("completely-unknown-slug-for-sure");
      expect(id).toMatch(/^a0000000-0000-0000-0000-[0-9a-f]{12}$/);
    });
  });
});
