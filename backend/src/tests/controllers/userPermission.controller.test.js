/**
 * Tests for userPermission controller
 */

jest.mock("../../services/userPermission.service", () => ({
  getUserPermissions: jest.fn(),
  setUserPermission: jest.fn(),
  removeUserPermission: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const userPermissionController = require("../../controllers/userPermission.controller");
const userPermissionService = require("../../services/userPermission.service");
const { success, error } = require("../../utils/response.util");

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const MENU_GROUP_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("userPermission Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    error.mockImplementation((res, message, statusCode) => {
      res.status(statusCode).json({
        success: false,
        status: statusCode,
        message,
        data: null,
      });
    });
    req = {
      params: {},
      body: {},
      user: { id: "user-1", tenantId: "tenant-1" },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getUserPermissions", () => {
    it("should return user permissions", async () => {
      req.params = { userId: USER_ID };
      userPermissionService.getUserPermissions.mockResolvedValue({
        success: true,
        status: 200,
        message: "User permissions fetched successfully",
        data: {
          user: { id: USER_ID, username: "john" },
          rolePermissions: [],
          overrides: [],
          effective: [],
        },
      });

      await userPermissionController.getUserPermissions(req, res, next);

      expect(userPermissionService.getUserPermissions).toHaveBeenCalledWith(USER_ID);
      expect(success).toHaveBeenCalled();
    });

    it("should return 404 when user not found", async () => {
      req.params = { userId: "invalid-id" };
      const AppError = { status: 404, message: "User not found" };
      userPermissionService.getUserPermissions.mockRejectedValue(AppError);

      await userPermissionController.getUserPermissions(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("setUserPermission", () => {
    it("should set a user permission", async () => {
      req.params = { userId: USER_ID };
      req.body = { menuGroupId: MENU_GROUP_ID, permissionType: "read", notes: "test" };
      userPermissionService.setUserPermission.mockResolvedValue({
        success: true,
        status: 201,
        message: "Custom permission assigned successfully",
        data: { id: "perm-1", menuGroupId: MENU_GROUP_ID },
      });

      await userPermissionController.setUserPermission(req, res, next);

      expect(userPermissionService.setUserPermission).toHaveBeenCalledWith(
        USER_ID,
        MENU_GROUP_ID,
        "read",
        "user-1",
        "test",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 when menuGroupId is missing", async () => {
      req.params = { userId: USER_ID };
      req.body = { permissionType: "read" };

      await userPermissionController.setUserPermission(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          status: 400,
          message: "menuGroupId and permissionType are required",
        }),
      );
    });

    it("should return 400 when permissionType is missing", async () => {
      req.params = { userId: USER_ID };
      req.body = { menuGroupId: MENU_GROUP_ID };

      await userPermissionController.setUserPermission(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should default grantedBy to null when user is not on req", async () => {
      req.params = { userId: USER_ID };
      req.body = { menuGroupId: MENU_GROUP_ID, permissionType: "read" };
      req.user = {};
      userPermissionService.setUserPermission.mockResolvedValue({
        success: true,
        status: 201,
        data: { id: "perm-1" },
      });

      await userPermissionController.setUserPermission(req, res, next);

      expect(userPermissionService.setUserPermission).toHaveBeenCalledWith(
        USER_ID,
        MENU_GROUP_ID,
        "read",
        null,
        null,
      );
    });
  });

  describe("removeUserPermission", () => {
    it("should remove a user permission", async () => {
      req.params = { userId: USER_ID, menuGroupId: MENU_GROUP_ID };
      userPermissionService.removeUserPermission.mockResolvedValue({
        success: true,
        status: 200,
        message: "Custom permission removed — role inheritance restored",
        data: null,
      });

      await userPermissionController.removeUserPermission(req, res, next);

      expect(userPermissionService.removeUserPermission).toHaveBeenCalledWith(
        USER_ID,
        MENU_GROUP_ID,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle service error", async () => {
      req.params = { userId: USER_ID, menuGroupId: MENU_GROUP_ID };
      userPermissionService.removeUserPermission.mockRejectedValue(
        new Error("Database error"),
      );

      await userPermissionController.removeUserPermission(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
