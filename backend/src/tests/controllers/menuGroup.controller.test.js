// Mock the models
jest.mock("../../models", () => ({
  Role: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  MenuGroup: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
  RoleMenuPermission: {
    findAll: jest.fn(),
    findOrCreate: jest.fn(),
    destroy: jest.fn(),
  },
}));

// A-173: create/update/delete run in a managed transaction and audit through
// logAction under the PLATFORM tenant (menuGroup.audit.a173.test.js); here
// the controller is checked to pass the request's actor through.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/redis.service", () => ({
  del: jest.fn().mockResolvedValue(0),
  delPattern: jest.fn().mockResolvedValue(0),
  cacheKeys: { permissions: (roleId) => `permissions:role:${roleId}` },
}));

// Mock success and error responses
jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    return res.status(status || 200).json({ success: true, data, meta, message });
  }),
  error: jest.fn((res, message, status) => {
    return res.status(status || 500).json({ success: false, message });
  }),
}));

const { filterMenuGroups, getRoleMenuAssignments, getAvailableRoles, createMenuGroup, updateMenuGroup, deleteMenuGroup, assignMenuGroupToRole, revokeMenuGroupFromRole, bulkAssignMenuGroups, bulkRevokeMenuGroups } = require("../../controllers/menuGroup.controller");
const { Role, MenuGroup, RoleMenuPermission } = require("../../models");
const { success } = require("../../utils/response.util");
const auditService = require("../../services/audit.service");

describe("MenuGroup Controller Tests", () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      body: {},
      params: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe("filterMenuGroups", () => {
    it("should fetch and format menu groups without roleId", async () => {
      const mockGroups = [
        {
          id: "parent-1",
          name: "Home",
          slug: "home",
          icon: "home-icon",
          sortOrder: 1,
          children: [
            {
              id: "child-1",
              name: "Profile",
              slug: "profile-page",
              icon: "profile-icon",
              sortOrder: 1,
            },
            {
              id: "child-2",
              name: "Change Password",
              slug: "change-password",
              icon: "password-icon",
              sortOrder: 2,
            },
          ],
        },
        {
          id: "parent-2",
          name: "Management",
          slug: "management",
          icon: "mgmt-icon",
          sortOrder: 2,
          children: [],
        },
      ];

      MenuGroup.findAll.mockResolvedValue(mockGroups);

      await filterMenuGroups(req, res);

      expect(MenuGroup.findAll).toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith(
        res,
        [
          {
            id: "parent-1",
            label: "Home",
            icon: "home-icon",
            path: "/",
            sortOrder: 1,
            isAssigned: undefined,
            items: [
              {
                id: "child-1",
                label: "Profile",
                icon: "profile-icon",
                path: "/dashboard/profile",
                requiredPermission: undefined,
                isAssigned: undefined,
                sortOrder: 1,
              },
              {
                id: "child-2",
                label: "Change Password",
                icon: "password-icon",
                path: "/dashboard/change-password",
                requiredPermission: undefined,
                isAssigned: undefined,
                sortOrder: 2,
              },
            ],
          },
          {
            id: "parent-2",
            label: "Management",
            icon: "mgmt-icon",
            path: "/dashboard/management",
            sortOrder: 2,
            isAssigned: undefined,
            items: [],
          },
        ],
        null,
        "Menu groups fetched successfully",
        200,
      );
    });

    it("should fetch and format menu groups showing assignments if roleId is provided", async () => {
      req.query.roleId = "role-uuid";
      RoleMenuPermission.findAll.mockResolvedValue([
        { menuGroupId: "parent-1" },
        { menuGroupId: "child-1" },
      ]);

      const mockGroups = [
        {
          id: "parent-1",
          name: "Calibration Devices",
          slug: "calibration",
          icon: "cal-icon",
          sortOrder: 1,
          children: [
            {
              id: "child-1",
              name: "Certificates",
              slug: "certificate",
              icon: "cert-icon",
              sortOrder: 1,
            },
            {
              id: "child-2",
              name: "Unassigned Item",
              slug: "unassigned",
              icon: "unassigned-icon",
              sortOrder: 2,
            },
          ],
        },
      ];

      MenuGroup.findAll.mockResolvedValue(mockGroups);

      await filterMenuGroups(req, res);

      expect(RoleMenuPermission.findAll).toHaveBeenCalledWith({
        where: { roleId: "role-uuid" },
      });
      expect(success).toHaveBeenCalledWith(
        res,
        [
          {
            id: "parent-1",
            label: "Calibration Devices",
            icon: "cal-icon",
            path: "/dashboard/devices",
            sortOrder: 1,
            isAssigned: true,
            items: [
              {
                id: "child-1",
                label: "Certificates",
                icon: "cert-icon",
                path: "/dashboard/calibration",
                requiredPermission: undefined,
                isAssigned: true,
                sortOrder: 1,
              },
              {
                id: "child-2",
                label: "Unassigned Item",
                icon: "unassigned-icon",
                path: "/dashboard/unassigned",
                requiredPermission: undefined,
                isAssigned: false,
                sortOrder: 2,
              },
            ],
          },
        ],
        null,
        "Menu groups fetched successfully",
        200,
      );
    });

    it("should verify mapSlugToPath custom mapping slugs", async () => {
      const slugsToTest = [
        { slug: "menu-groups", path: "/dashboard/menu-groups" },
        { slug: "tenants", path: "/dashboard/tenants" },
        { slug: "roles", path: "/dashboard/roles" },
        { slug: "users", path: "/dashboard/users" },
        { slug: "permissions", path: "/dashboard/permissions" },
        { slug: "sessions", path: "/dashboard/session-management" },
        { slug: "warehouse", path: "/dashboard/warehouses" },
        { slug: "custom-slug", path: "/dashboard/custom-slug" },
      ];

      for (const item of slugsToTest) {
        MenuGroup.findAll.mockResolvedValueOnce([
          {
            id: "test-id",
            name: "Test Name",
            slug: item.slug,
            icon: "icon",
            sortOrder: 1,
            children: [],
          },
        ]);
        await filterMenuGroups(req, res);
        const lastCallData = success.mock.calls[success.mock.calls.length - 1][1];
        expect(lastCallData[0].path).toBe(item.path);
      }
    });

    // Regression: this handler serves two GET routes, and Express 5 no longer
    // defaults an absent body to {}. Reading req.body.roleId unguarded threw
    // "Cannot read properties of undefined (reading 'roleId')" and reached
    // production as a 500 on /menu-groups/menu-groups/admin. Every other test
    // here sets body: {}, which is exactly why none of them caught it.
    it("should not throw when req.body is undefined (GET with no body)", async () => {
      req.body = undefined;
      MenuGroup.findAll.mockResolvedValue([]);

      await expect(filterMenuGroups(req, res)).resolves.not.toThrow();

      expect(RoleMenuPermission.findAll).not.toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });

    it("should still read roleId from the query string when req.body is undefined", async () => {
      req.body = undefined;
      req.query = { roleId: "role-1" };
      RoleMenuPermission.findAll.mockResolvedValue([{ menuGroupId: "parent-1" }]);
      MenuGroup.findAll.mockResolvedValue([]);

      await filterMenuGroups(req, res);

      expect(RoleMenuPermission.findAll).toHaveBeenCalledWith({
        where: { roleId: "role-1" },
      });
    });
  });

  describe("getRoleMenuAssignments", () => {
    it("should fail validation if roleId is not a valid UUID", async () => {
      req.body.roleId = "invalid-uuid";
      await getRoleMenuAssignments(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining("Validation failed"),
        }),
      );
    });

    it("should return assigned menus and items", async () => {
      req.body.roleId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      RoleMenuPermission.findAll.mockResolvedValue([
        { menuGroupId: "parent-1" },
        { menuGroupId: "child-1" },
      ]);

      const mockGroups = [
        {
          id: "parent-1",
          name: "Home",
          slug: "home",
          icon: "home-icon",
          sortOrder: 1,
          children: [
            {
              id: "child-1",
              name: "Profile",
              slug: "profile-page",
              icon: "profile-icon",
              sortOrder: 1,
            },
            {
              id: "child-2",
              name: "Change Password",
              slug: "change-password",
              icon: "password-icon",
              sortOrder: 2,
            },
          ],
        },
        {
          id: "parent-2",
          name: "Management",
          slug: "management",
          icon: "mgmt-icon",
          sortOrder: 2,
          children: [
            {
              id: "child-3",
              name: "Users",
              slug: "users",
              icon: "users-icon",
              sortOrder: 1,
            },
          ],
        },
      ];

      MenuGroup.findAll.mockResolvedValue(mockGroups);

      await getRoleMenuAssignments(req, res);

      expect(success).toHaveBeenCalledWith(
        res,
        [
          {
            id: "parent-1",
            label: "Home",
            icon: "home-icon",
            path: "/",
            sortOrder: 1,
            items: [
              {
                id: "child-1",
                label: "Profile",
                icon: "profile-icon",
                path: "/dashboard/profile",
                requiredPermission: undefined,
              },
              {
                id: "child-2",
                label: "Change Password",
                icon: "password-icon",
                path: "/dashboard/change-password",
                requiredPermission: undefined,
              },
            ],
          },
        ],
        null,
        "Role menu assignments fetched successfully",
        200,
      );
    });
  });

  describe("getAvailableRoles", () => {
    it("should fetch available roles successfully", async () => {
      const mockRoles = [{ id: "role-1", name: "SUPERADMIN", sortOrder: 1 }];
      Role.findAll.mockResolvedValue(mockRoles);

      await getAvailableRoles(req, res);

      expect(Role.findAll).toHaveBeenCalledWith({
        order: [["sortOrder", "ASC"]],
      });
      expect(success).toHaveBeenCalledWith(
        res,
        mockRoles,
        null,
        "Roles fetched successfully",
        200,
      );
    });
  });

  describe("createMenuGroup", () => {
    it("should fail validation on invalid body parameters", async () => {
      req.body = { name: "A" }; // name too short
      await createMenuGroup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should create menu group successfully with explicit slug", async () => {
      req.body = {
        name: "Test Group",
        slug: "test-explicit-slug",
        icon: "test-icon",
        sortOrder: 5,
        isActive: true,
      };

      const mockCreated = {
        id: "new-uuid",
        name: "Test Group",
        slug: "test-explicit-slug",
        icon: "test-icon",
        sortOrder: 5,
        isActive: true,
        children: [],
      };

      MenuGroup.create.mockResolvedValue(mockCreated);

      await createMenuGroup(req, res);

      expect(MenuGroup.create).toHaveBeenCalledWith({
        name: "Test Group",
        slug: "test-explicit-slug",
        icon: "test-icon",
        parentId: undefined,
        sortOrder: 5,
        isActive: true,
      }, { transaction: "TX" });

      expect(success).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          id: "new-uuid",
          label: "Test Group",
          path: "/dashboard/test-explicit-slug",
        }),
        null,
        "Menu group created successfully",
        201,
      );
    });

    it("should create menu group successfully and auto-generate slug if omitted", async () => {
      req.body = {
        name: "Auto Slug Group Name",
        icon: "icon",
      };

      const mockCreated = {
        id: "new-uuid-2",
        name: "Auto Slug Group Name",
        slug: "auto-slug-group-name",
        icon: "icon",
        sortOrder: 0,
        isActive: true,
        children: [],
      };

      MenuGroup.create.mockResolvedValue(mockCreated);

      await createMenuGroup(req, res);

      expect(MenuGroup.create).toHaveBeenCalledWith({
        name: "Auto Slug Group Name",
        slug: "auto-slug-group-name",
        icon: "icon",
        parentId: undefined,
        sortOrder: 0,
        isActive: true,
      }, { transaction: "TX" });
    });
  });

  describe("updateMenuGroup", () => {
    it("should fail validation if id is missing", async () => {
      req.body = { name: "Update Name" };
      await updateMenuGroup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 if menu group does not exist", async () => {
      req.body = {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        name: "Update Name",
      };
      MenuGroup.findByPk.mockResolvedValue(null);

      await updateMenuGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Menu group not found",
        }),
      );
    });

    it("should update and return menu group successfully", async () => {
      req.body = {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        name: "Updated Name",
        slug: "updated-slug",
        icon: "updated-icon",
        parentId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
        sortOrder: 10,
        isActive: false,
      };

      const mockGroupInstance = {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        name: "Old Name",
        slug: "old-slug",
        icon: "old-icon",
        parentId: null,
        sortOrder: 1,
        isActive: true,
        update: jest.fn().mockImplementation(function (data) {
          Object.assign(this, data);
          return this;
        }),
      };

      MenuGroup.findByPk.mockResolvedValue(mockGroupInstance);

      await updateMenuGroup(req, res);

      expect(mockGroupInstance.update).toHaveBeenCalledWith({
        name: "Updated Name",
        slug: "updated-slug",
        icon: "updated-icon",
        parentId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
        sortOrder: 10,
        isActive: false,
      }, { transaction: "TX" });

      expect(success).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          label: "Updated Name",
          icon: "updated-icon",
        }),
        null,
        "Menu group updated successfully",
        200,
      );
    });
  });

  describe("deleteMenuGroup", () => {
    it("should return 400 if menuGroupId is missing", async () => {
      await deleteMenuGroup(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "menuGroupId is required",
        }),
      );
    });

    it("should return 404 if menu group to delete is not found", async () => {
      req.body.menuGroupId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      MenuGroup.findByPk.mockResolvedValue(null);

      await deleteMenuGroup(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Menu group not found",
        }),
      );
    });

    it("should delete an empty menu group and its grants successfully", async () => {
      req.body.menuGroupId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      const mockGroupInstance = {
        id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        destroy: jest.fn().mockResolvedValue(true),
      };

      MenuGroup.findByPk.mockResolvedValue(mockGroupInstance);
      RoleMenuPermission.destroy.mockResolvedValue(1);
      MenuGroup.destroy.mockResolvedValue(1);
      MenuGroup.findAll.mockResolvedValue([]);

      await deleteMenuGroup(req, res);

      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({
        where: { menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" },
        transaction: "TX",
      });
      // A-181: a delete never removes or orphans child menus.
      expect(MenuGroup.destroy).not.toHaveBeenCalled();
      expect(mockGroupInstance.destroy).toHaveBeenCalledWith({ transaction: "TX" });
      expect(success).toHaveBeenCalledWith(res, null, null, "Menu group deleted successfully", 200);
    });
  });

  describe("A-173 — the request's actor reaches the audit row", () => {
    const actorReq = (body) => ({
      query: {},
      params: {},
      body,
      user: { id: "super-1", tenantId: "home-tenant" },
      ip: "10.0.0.7",
      headers: { "user-agent": "UA" },
    });
    const actorEntry = expect.objectContaining({ userId: "super-1", ipAddress: "10.0.0.7", userAgent: "UA" });

    it("createMenuGroup, updateMenuGroup and deleteMenuGroup pass auditActor(req) to the service", async () => {
      const group = { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", name: "G", slug: "g", children: [], update: jest.fn(), destroy: jest.fn() };
      MenuGroup.create.mockResolvedValue(group);
      MenuGroup.findByPk.mockResolvedValue(group);
      MenuGroup.findAll.mockResolvedValue([]);

      await createMenuGroup(actorReq({ name: "Group G", icon: "i" }), res);
      await updateMenuGroup(actorReq({ id: group.id, name: "Group H" }), res);
      await deleteMenuGroup(actorReq({ menuGroupId: group.id }), res);

      expect(auditService.logAction.mock.calls.map(([entry]) => entry.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
      for (const [entry, options] of auditService.logAction.mock.calls) {
        expect(entry).toEqual(actorEntry);
        expect(options).toEqual({ transaction: "TX" });
      }
    });
  });

  describe("assignMenuGroupToRole", () => {
    it("should fail validation if params are invalid", async () => {
      req.body = { roleId: "invalid-uuid" };
      await assignMenuGroupToRole(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 if role is not found", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      };
      Role.findByPk.mockResolvedValue(null);

      await assignMenuGroupToRole(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Role not found",
        }),
      );
    });

    it("should return 404 if menu group is not found", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      };
      Role.findByPk.mockResolvedValue({ id: "role-1" });
      MenuGroup.findByPk.mockResolvedValue(null);

      await assignMenuGroupToRole(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Menu group or item not found",
        }),
      );
    });

    it("should assign menu group to role successfully", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      };
      Role.findByPk.mockResolvedValue({ id: "role-1" });
      MenuGroup.findByPk.mockResolvedValue({ id: "group-1" });
      RoleMenuPermission.findOrCreate.mockResolvedValue([{ id: "perm-1" }, true]);

      await assignMenuGroupToRole(req, res);

      expect(RoleMenuPermission.findOrCreate).toHaveBeenCalledWith({
        where: {
          roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
        },
        defaults: { permissionType: "read" },
        transaction: "TX",
      });
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "perm-1" },
        null,
        "Menu assigned successfully",
        200,
      );
    });

    it("should assign menu item to role successfully when menuItemId is passed", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuItemId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
      };
      Role.findByPk.mockResolvedValue({ id: "role-1" });
      MenuGroup.findByPk.mockResolvedValue({ id: "item-1" });
      RoleMenuPermission.findOrCreate.mockResolvedValue([{ id: "perm-2" }, true]);

      await assignMenuGroupToRole(req, res);

      expect(RoleMenuPermission.findOrCreate).toHaveBeenCalledWith({
        where: {
          roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
        },
        defaults: { permissionType: "read" },
        transaction: "TX",
      });
    });
  });

  describe("revokeMenuGroupFromRole", () => {
    it("should fail validation if params are invalid", async () => {
      req.body = { roleId: "invalid-uuid" };
      await revokeMenuGroupFromRole(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should revoke menu group from role successfully", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      };

      RoleMenuPermission.destroy.mockResolvedValue(1);

      await revokeMenuGroupFromRole(req, res);

      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({
        where: {
          roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa7",
        },
        transaction: "TX",
      });
      expect(success).toHaveBeenCalledWith(res, null, null, "Menu revoked successfully", 200);
    });

    it("should revoke menu item from role successfully when menuItemId is passed", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuItemId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
      };

      RoleMenuPermission.destroy.mockResolvedValue(1);

      await revokeMenuGroupFromRole(req, res);

      expect(RoleMenuPermission.destroy).toHaveBeenCalledWith({
        where: {
          roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa8",
        },
        transaction: "TX",
      });
    });
  });

  describe("bulkAssignMenuGroups", () => {
    it("should fail validation if roleId or menuGroupIds are invalid", async () => {
      req.body = { roleId: "invalid-uuid", menuGroupIds: [] };
      await bulkAssignMenuGroups(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 if role does not exist", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupIds: ["3fa85f64-5717-4562-b3fc-2c963f66afa7"],
      };
      Role.findByPk.mockResolvedValue(null);

      await bulkAssignMenuGroups(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should process bulk assignment and handle assign, already assigned and not found", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupIds: [
          "3fa85f64-5717-4562-b3fc-2c963f66afa7", // Success assigned
          "3fa85f64-5717-4562-b3fc-2c963f66afa8", // Already assigned
          "3fa85f64-5717-4562-b3fc-2c963f66afa9", // Not found
        ],
      };

      Role.findByPk.mockResolvedValue({ id: "role-1" });
      // A-181: the ids are resolved in one read before the transaction.
      MenuGroup.findAll.mockResolvedValue([
        { id: "3fa85f64-5717-4562-b3fc-2c963f66afa7" },
        { id: "3fa85f64-5717-4562-b3fc-2c963f66afa8" },
      ]);

      RoleMenuPermission.findOrCreate.mockImplementation(async ({ where }) => {
        const id = where.menuGroupId;
        if (id === "3fa85f64-5717-4562-b3fc-2c963f66afa7") {
          return [{ id: "perm-new" }, true]; // Created
        }
        return [{ id: "perm-old" }, false]; // Already assigned
      });

      await bulkAssignMenuGroups(req, res);

      expect(success).toHaveBeenCalledWith(
        res,
        {
          assigned: ["3fa85f64-5717-4562-b3fc-2c963f66afa7"],
          alreadyAssigned: ["3fa85f64-5717-4562-b3fc-2c963f66afa8"],
          failed: [
            {
              menuGroupId: "3fa85f64-5717-4562-b3fc-2c963f66afa9",
              error: "Menu group not found",
            },
          ],
        },
        null,
        "Bulk assignment completed",
        200,
      );
    });
  });

  describe("bulkRevokeMenuGroups", () => {
    it("should fail validation if roleId or menuGroupIds are invalid", async () => {
      req.body = { roleId: "invalid-uuid", menuGroupIds: [] };
      await bulkRevokeMenuGroups(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should process bulk revocation successfully", async () => {
      req.body = {
        roleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        menuGroupIds: [
          "3fa85f64-5717-4562-b3fc-2c963f66afa7", // Revoked
          "3fa85f64-5717-4562-b3fc-2c963f66afa8", // Not found / not assigned
        ],
      };

      RoleMenuPermission.destroy.mockImplementation(async ({ where }) => {
        if (where.menuGroupId === "3fa85f64-5717-4562-b3fc-2c963f66afa7") {
          return 1; // deleted
        }
        return 0; // not found
      });

      await bulkRevokeMenuGroups(req, res);

      expect(success).toHaveBeenCalledWith(
        res,
        {
          revoked: ["3fa85f64-5717-4562-b3fc-2c963f66afa7"],
          notFound: ["3fa85f64-5717-4562-b3fc-2c963f66afa8"],
        },
        null,
        "Bulk revocation completed",
        200,
      );
    });
  });

  describe("MenuGroup Validator - formatErrors", () => {
    it("should format Joi validation errors correctly", () => {
      const menuGroupValidator = require("../../validators/menuGroup.validator");
      const mockDetails = [
        {
          path: ["body", "name"],
          message: '"name" is required',
        },
      ];
      const formatted = menuGroupValidator.formatErrors(mockDetails);
      expect(formatted).toEqual([
        {
          field: "body.name",
          message: '"name" is required',
        },
      ]);
    });
  });
});
