/**
 * Tests for roles controller
 */

jest.mock("../../services/roles.service", () => {
  const mockService = {
    getAllRoles: jest.fn(),
    getRoleById: jest.fn(),
    createRole: jest.fn(),
    updateRole: jest.fn(),
    deleteRole: jest.fn(),
    assignMenuToRole: jest.fn(),
    removeMenuFromRole: jest.fn(),
    assignRoleToUser: jest.fn(),
    removeRoleFromUser: jest.fn(),
    getAllMenus: jest.fn(),
    getMenuById: jest.fn(),
    createMenu: jest.fn(),
    updateMenu: jest.fn(),
    deleteMenu: jest.fn(),
  };
  return mockService;
});

const rolesService = require("../../services/roles.service");
const rolesController = require("../../controllers/roles.controller");

describe("roles Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      params: {},
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getAllRoles", () => {
    it("should return all roles with pagination", async () => {
      req.query = { page: "1", limit: "10" };
      rolesService.getAllRoles.mockResolvedValue({
        data: {
          rows: [
            { id: "role-1", name: "ADMIN" },
            { id: "role-2", name: "USER" },
          ],
        },
        count: 2,
        page: 1,
        limit: 10,
      });

      await rolesController.getAllRoles(req, res, next);

      expect(rolesService.getAllRoles).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        search: "",
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          rows: expect.any(Array),
        }),
        pagination: expect.objectContaining({
          page: 1,
          limit: 10,
          total: 2,
        }),
      });
    });

    it("should filter by search", async () => {
      req.query = { page: "1", limit: "10", search: "admin" };
      rolesService.getAllRoles.mockResolvedValue({
        data: { rows: [], count: 0, page: 1, limit: 10 },
      });

      await rolesController.getAllRoles(req, res, next);

      expect(rolesService.getAllRoles).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        search: "admin",
      });
    });

    it("should use defaults when no query params", async () => {
      req.query = {};
      rolesService.getAllRoles.mockResolvedValue({
        data: { rows: [], count: 0, page: 1, limit: 20 },
      });

      await rolesController.getAllRoles(req, res, next);

      expect(rolesService.getAllRoles).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        search: "",
      });
    });
  });

  describe("getRoleById", () => {
    it("should return a specific role", async () => {
      req.params = { id: "role-1" };
      rolesService.getRoleById.mockResolvedValue({
        id: "role-1",
        name: "ADMIN",
      });

      await rolesController.getRoleById(req, res, next);

      expect(rolesService.getRoleById).toHaveBeenCalledWith("role-1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "role-1", name: "ADMIN" },
      });
    });

    it("should return 404 when role not found", async () => {
      req.params = { id: "invalid" };
      rolesService.getRoleById.mockResolvedValue(null);

      await rolesController.getRoleById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Role not found",
      });
    });
  });

  describe("createRole", () => {
    it("should create a new role", async () => {
      req.body = { name: "MANAGER", description: "Manager role" };
      rolesService.createRole.mockResolvedValue({ id: "role-new" });
      rolesService.getRoleById.mockResolvedValue({
        id: "role-new",
        name: "MANAGER",
        description: "Manager role",
      });

      await rolesController.createRole(req, res, next);

      expect(rolesService.createRole).toHaveBeenCalledWith({
        name: "MANAGER",
        description: "Manager role",
      });
      expect(rolesService.getRoleById).toHaveBeenCalledWith("role-new");
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("updateRole", () => {
    it("should update a role", async () => {
      req.params = { id: "role-1" };
      req.body = {
        name: "ADMIN_UPDATED",
        description: "Updated",
        status: "active",
      };
      rolesService.updateRole.mockResolvedValue({
        id: "role-1",
        name: "ADMIN_UPDATED",
      });

      await rolesController.updateRole(req, res, next);

      expect(rolesService.updateRole).toHaveBeenCalledWith("role-1", {
        name: "ADMIN_UPDATED",
        description: "Updated",
        status: "active",
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("deleteRole", () => {
    it("should delete a role", async () => {
      req.params = { id: "role-1" };
      rolesService.deleteRole.mockResolvedValue({
        message: "Role deleted",
      });

      await rolesController.deleteRole(req, res, next);

      expect(rolesService.deleteRole).toHaveBeenCalledWith("role-1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Role deleted",
      });
    });
  });

  describe("assignPermissionToRole", () => {
    it("should assign permission to role", async () => {
      req.params = { roleId: "role-1" };
      req.body = { menuGroupId: "mg-1", permissionType: "read" };
      rolesService.assignMenuToRole.mockResolvedValue({
        id: "perm-1",
        roleId: "role-1",
        menuGroupId: "mg-1",
      });

      await rolesController.assignPermissionToRole(req, res, next);

      expect(rolesService.assignMenuToRole).toHaveBeenCalledWith(
        "role-1",
        "mg-1",
        "read",
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should default permissionType to read", async () => {
      req.params = { roleId: "role-1" };
      req.body = { menuGroupId: "mg-1" };
      rolesService.assignMenuToRole.mockResolvedValue({
        id: "perm-1",
      });

      await rolesController.assignPermissionToRole(req, res, next);

      expect(rolesService.assignMenuToRole).toHaveBeenCalledWith(
        "role-1",
        "mg-1",
        "read",
      );
    });
  });

  describe("removePermissionFromRole", () => {
    it("should remove permission from role", async () => {
      req.params = { roleId: "role-1", menuGroupId: "mg-1" };
      rolesService.removeMenuFromRole.mockResolvedValue({
        message: "Permission removed",
      });

      await rolesController.removePermissionFromRole(req, res, next);

      expect(rolesService.removeMenuFromRole).toHaveBeenCalledWith(
        "role-1",
        "mg-1",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("assignRoleToUser", () => {
    it("should assign role to user", async () => {
      req.body = { userId: "user-1", roleId: "role-1" };
      rolesService.assignRoleToUser.mockResolvedValue({
        id: "user-1",
        roleId: "role-1",
      });

      await rolesController.assignRoleToUser(req, res, next);

      expect(rolesService.assignRoleToUser).toHaveBeenCalledWith(
        "user-1",
        "role-1",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("removeRoleFromUser", () => {
    it("should remove role from user", async () => {
      req.params = { userId: "user-1" };
      rolesService.removeRoleFromUser.mockResolvedValue({
        message: "Role removed",
      });

      await rolesController.removeRoleFromUser(req, res, next);

      expect(rolesService.removeRoleFromUser).toHaveBeenCalledWith("user-1");
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ==========================================
  //                     MENU GROUPS
  // ==========================================

  describe("getAllMenus", () => {
    it("should return all menus with pagination", async () => {
      req.query = { page: "1", limit: "10" };
      rolesService.getAllMenus.mockResolvedValue({
        data: {
          rows: [
            { id: "mg-1", name: "Dashboard" },
            { id: "mg-2", name: "Users" },
          ],
        },
        count: 2,
        page: 1,
        limit: 10,
      });

      await rolesController.getAllMenus(req, res, next);

      expect(rolesService.getAllMenus).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        search: "",
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          rows: expect.any(Array),
        }),
        pagination: expect.objectContaining({
          page: 1,
          limit: 10,
          total: 2,
        }),
      });
    });

    it("should filter menus by search", async () => {
      req.query = { page: "1", limit: "10", search: "dashboard" };
      rolesService.getAllMenus.mockResolvedValue({
        data: { rows: [], count: 0, page: 1, limit: 10 },
      });

      await rolesController.getAllMenus(req, res, next);

      expect(rolesService.getAllMenus).toHaveBeenCalledWith({
        limit: 10,
        offset: 0,
        search: "dashboard",
      });
    });

    it("should use defaults when no query params", async () => {
      req.query = {};
      rolesService.getAllMenus.mockResolvedValue({
        data: { rows: [], count: 0, page: 1, limit: 20 },
      });

      await rolesController.getAllMenus(req, res, next);

      expect(rolesService.getAllMenus).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        search: "",
      });
    });
  });

  describe("getMenuById", () => {
    it("should return a specific menu group", async () => {
      req.params = { id: "mg-1" };
      rolesService.getMenuById.mockResolvedValue({
        id: "mg-1",
        name: "Dashboard",
      });

      await rolesController.getMenuById(req, res, next);

      expect(rolesService.getMenuById).toHaveBeenCalledWith("mg-1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { id: "mg-1", name: "Dashboard" },
      });
    });

    it("should return 404 when menu group not found", async () => {
      req.params = { id: "invalid" };
      rolesService.getMenuById.mockResolvedValue(null);

      await rolesController.getMenuById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Menu group not found",
      });
    });
  });

  describe("createMenu", () => {
    it("should create a new menu group", async () => {
      const menuMock = {
        id: "mg-new",
        name: "Reports",
        icon: "bar-chart-2",
        route: "/reports"
      };
      jest.spyOn(rolesService, 'createMenu').mockReturnValueOnce(menuMock);

      await rolesController.createMenu(req, res, next);

      expect(rolesService.createMenu).toHaveBeenCalledWith(req.body);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: "mg-new",
          name: "Reports",
        }),
      });
    });
  });

  describe("updateMenu", () => {
    it("should update a menu group", async () => {
      const menuMock = {
        id: "mg-1",
        name: "Dashboard",
        icon: "settings"
      };
      req.params = { id: "mg-1" };
      jest.spyOn(rolesService, 'updateMenu').mockReturnValueOnce(menuMock);

      await rolesController.updateMenu(req, res, next);

      expect(rolesService.updateMenu).toHaveBeenCalledWith("mg-1", req.body);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: "mg-1",
        }),
      });
    });
  });

  describe("deleteMenu", () => {
    it("should delete a menu group", async () => {
      req.params = { id: "mg-1" };
      jest.spyOn(rolesService, 'deleteMenu').mockReturnValueOnce({ message: "Menu group deleted" });

      await rolesController.deleteMenu(req, res, next);

      expect(rolesService.deleteMenu).toHaveBeenCalledWith("mg-1");
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: expect.stringContaining("deleted")
      });
    });
  });
});
