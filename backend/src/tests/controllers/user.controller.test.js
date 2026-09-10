/**
 * Tests for user controller
 */

jest.mock("../../services/user.service", () => ({
  fetchUsers: jest.fn(),
  fetchSpecificUser: jest.fn(),
  checkUsernameAvailability: jest.fn(),
  userRoleUpdate: jest.fn(),
  userCreate: jest.fn(),
  editUser: jest.fn(),
  deleteUser: jest.fn(),
  updateUserAvatar: jest.fn(),
  removeUserAvatar: jest.fn(),
}));

jest.mock("../../models", () => ({
  Users: {
    findAll: jest.fn().mockResolvedValue([{ id: "1", username: "john", firstName: "John" }]),
  },
  Roles: {},
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const userService = require("../../services/user.service");
const userController = require("../../controllers/user.controller");
const { success } = require("../../utils/response.util");

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_ROLE_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("user Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        role: { name: "USER" },
        tenantId: VALID_TENANT_ID,
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getAllUsers", () => {
    it("should return paginated users", async () => {
      req.query = { page: "1", limit: "10", find: "john" };
      userService.fetchUsers.mockResolvedValue({
        data: { rows: [{ id: VALID_USER_ID, username: "john" }] },
        meta: { total: 1 },
      });

      await userController.getAllUsers(req, res, next);

      expect(userService.fetchUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: VALID_TENANT_ID,
          find: "john",
          page: 1,
          limit: 10,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should restrict non-SUPER_ADMIN to their tenant", async () => {
      req.query = { page: "1", limit: "10" };
      req.user.role.name = "USER";
      userService.fetchUsers.mockResolvedValue({
        data: { rows: [], meta: { total: 0 } },
      });

      await userController.getAllUsers(req, res, next);

      expect(userService.fetchUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: VALID_TENANT_ID,
        }),
      );
    });

    it("should allow SUPER_ADMIN to specify tenant", async () => {
      const targetTenant = "550e8400-e29b-41d4-a716-446655440099";
      req.query = { page: "1", limit: "10", tenantId: targetTenant };
      req.user.role.name = "SUPER_ADMIN";
      userService.fetchUsers.mockResolvedValue({
        data: { rows: [], meta: { total: 0 } },
      });

      await userController.getAllUsers(req, res, next);

      expect(userService.fetchUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: targetTenant,
        }),
      );
    });

    it("should return 400 on validation error", async () => {
      req.query = { page: "invalid" };
      await userController.getAllUsers(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("getSpecificUser", () => {
    it("should return a specific user", async () => {
      req.params = { userId: VALID_USER_ID };
      userService.fetchSpecificUser.mockResolvedValue({
        data: { id: VALID_USER_ID, username: "john" },
      });

      await userController.getSpecificUser(req, res, next);

      expect(userService.fetchSpecificUser).toHaveBeenCalledWith(VALID_USER_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("checkUsernameAvailability", () => {
    it("should check username availability", async () => {
      req.body = { username: "john" };
      userService.checkUsernameAvailability.mockResolvedValue({
        data: { available: true },
      });

      await userController.checkUsernameAvailability(req, res, next);

      expect(userService.checkUsernameAvailability).toHaveBeenCalledWith({
        username: "john",
      });
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on invalid username", async () => {
      req.body = { username: "" };

      await userController.checkUsernameAvailability(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });

  describe("updateUserRole", () => {
    it("should update user role", async () => {
      req.body = { userId: VALID_USER_ID, roleId: VALID_ROLE_ID };
      userService.userRoleUpdate.mockResolvedValue({
        data: { id: VALID_USER_ID, roleId: VALID_ROLE_ID },
      });

      await userController.updateUserRole(req, res, next);

      expect(userService.userRoleUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: VALID_USER_ID,
          roleId: VALID_ROLE_ID,
          updatedBy: VALID_USER_ID,
          actorTenantId: VALID_TENANT_ID,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation error", async () => {
      req.body = { userId: VALID_USER_ID };

      await userController.updateUserRole(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });

  describe("createUser", () => {
    it("should create a user", async () => {
      req.body = {
        username: "john",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        password: "password123",
        roleId: VALID_ROLE_ID,
      };
      userService.userCreate.mockResolvedValue({
        data: { id: "user-new", username: "john" },
        status: 201,
      });

      await userController.createUser(req, res, next);

      expect(userService.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: VALID_USER_ID,
          actorTenantId: VALID_TENANT_ID,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on validation error", async () => {
      req.body = { username: "" };

      await userController.createUser(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
    });
  });

  describe("editUser", () => {
    it("should edit a user", async () => {
      req.body = {
        userId: VALID_USER_ID,
        firstName: "John Updated",
      };
      userService.editUser.mockResolvedValue({
        data: { id: VALID_USER_ID, firstName: "John Updated" },
      });

      await userController.editUser(req, res, next);

      expect(userService.editUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: VALID_USER_ID,
          updatedBy: VALID_USER_ID,
          actorTenantId: VALID_TENANT_ID,
        }),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteUser", () => {
    it("should delete a user", async () => {
      req.query = { userId: VALID_USER_ID };
      userService.deleteUser.mockResolvedValue({
        data: { message: "User deleted" },
      });

      await userController.deleteUser(req, res, next);

      expect(userService.deleteUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: VALID_USER_ID,
          deletedBy: VALID_USER_ID,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on invalid userId", async () => {
      req.query = { userId: "not-a-uuid" };

      await userController.deleteUser(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("uploadUserAvatar", () => {
    it("should upload user avatar", async () => {
      req.params = { userId: VALID_USER_ID };
      req.file = { originalname: "avatar.jpg" };
      req.uploadFilename = "avatar-123.jpg";
      userService.updateUserAvatar.mockResolvedValue({
        data: { avatarUrl: "/avatars/avatar-123.jpg" },
      });

      await userController.uploadUserAvatar(req, res, next);

      expect(userService.updateUserAvatar).toHaveBeenCalledWith(
        VALID_USER_ID,
        "avatar-123.jpg",
        VALID_USER_ID,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 when no file uploaded", async () => {
      req.params = { userId: VALID_USER_ID };
      req.file = null;

      await userController.uploadUserAvatar(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("removeUserAvatar", () => {
    it("should remove user avatar", async () => {
      req.params = { userId: VALID_USER_ID };
      userService.removeUserAvatar.mockResolvedValue({
        data: { message: "Avatar removed" },
      });

      await userController.removeUserAvatar(req, res, next);

      expect(userService.removeUserAvatar).toHaveBeenCalledWith(
        VALID_USER_ID,
        VALID_USER_ID,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("actor / envelope fallbacks", () => {
    it("getAllUsers resolves actorTenantId to null when the user has no tenant", async () => {
      // getActor() reads `req.user?.tenantId || null`. A non-super-admin with no
      // tenant is scoped to null rather than to a client-supplied tenantId.
      req.user = { id: VALID_USER_ID, role: { name: "USER" } };
      req.query = { tenantId: VALID_TENANT_ID };
      userService.fetchUsers.mockResolvedValue({
        data: { rows: [] },
        meta: { total: 0 },
      });

      await userController.getAllUsers(req, res, next);

      expect(userService.fetchUsers).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: null }),
      );
    });

    it("getAllUsers passes result.data straight through when it is not a {rows} envelope", async () => {
      const users = [{ id: VALID_USER_ID, username: "john" }];
      userService.fetchUsers.mockResolvedValue({
        data: users,
        meta: { total: 1 },
      });

      await userController.getAllUsers(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        users,
        { total: 1 },
        "Fetch users successful",
        200,
      );
    });

    it("createUser sends createdBy null when the actor has no id, and falls back to 201", async () => {
      req.user = { id: undefined, role: { name: "SUPER_ADMIN" } };
      req.body = {
        username: "janedoe",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        password: "supersecret",
        roleId: VALID_ROLE_ID,
      };
      userService.userCreate.mockResolvedValue({
        data: { id: VALID_USER_ID },
        message: "User created successfully",
      });

      await userController.createUser(req, res, next);

      expect(userService.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: null,
          actorTenantId: null,
          actorIsSuperAdmin: true,
        }),
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { id: VALID_USER_ID },
        null,
        "User created successfully",
        201,
      );
    });

    it("editUser sends updatedBy null when the actor has no id", async () => {
      req.user = { id: undefined, role: { name: "SUPERADMIN" } };
      req.body = { userId: VALID_USER_ID, firstName: "Jane" };
      userService.editUser.mockResolvedValue({
        data: { id: VALID_USER_ID },
        status: 200,
      });

      await userController.editUser(req, res, next);

      expect(userService.editUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: VALID_USER_ID,
          updatedBy: null,
          actorIsSuperAdmin: true,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("deleteUser sends deletedBy null when the actor has no id", async () => {
      req.user = { id: undefined, role: { name: "USER" }, tenantId: VALID_TENANT_ID };
      req.query = { userId: VALID_USER_ID };
      userService.deleteUser.mockResolvedValue({
        data: { id: VALID_USER_ID },
        message: "User deleted successfully",
      });

      await userController.deleteUser(req, res, next);

      expect(userService.deleteUser).toHaveBeenCalledWith({
        userId: VALID_USER_ID,
        deletedBy: null,
        actorTenantId: VALID_TENANT_ID,
        actorIsSuperAdmin: false,
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getAllUsersSimple", () => {
    it("should return simple user list", async () => {
      req.query = { page: "1", limit: "10" };
      userService.fetchUsers.mockResolvedValue({
        data: { rows: [{ id: "1", username: "john", firstName: "John" }] },
        meta: { total: 1 },
      });

      await userController.getAllUsersSimple(req, res, next);

      expect(success).toHaveBeenCalled();
    });
  });
});
