import { userService } from "./user.service";
import { api } from "../client";

// Mock the api module
jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

describe("userService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAll", () => {
    it("should fetch and return users with pagination following Swagger spec", async () => {
      // Actual backend response: { success, status, message, data: User[], meta: {...} }
      const mockResponse = {
        success: true,
        status: 200,
        message: "Users fetched successfully",
        data: [
          {
            id: "user-uuid-1",
            tenantId: "tenant-uuid-1",
            username: "john_doe",
            firstName: "John",
            lastName: "Doe",
            email: "john@example.com",
            picture: "picture-url",
            tenantRoleId: "role-uuid-1",
            isEmailVerified: true,
            isBanned: false,
            lastLoginAt: "2024-01-01T00:00:00Z",
            createdAt: "2024-01-01T00:00:00Z",
            role: {
              id: "role-uuid-1",
              name: "USER",
              description: "Regular user",
              nameToShow: "User",
              isActive: true,
            },
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        },
      };

      (api.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await userService.getAll(1, 50, "john");

      expect(api.get).toHaveBeenCalledWith("/api/v1/users/all", {
        params: {
          page: 1,
          limit: 50,
          find: "john",
          tenantId: undefined,
          roleFilter: undefined,
        },
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].username).toBe("john_doe");
      expect(result.data[0].email).toBe("john@example.com");
      expect(result.meta?.total).toBe(1);
      expect(result.meta?.page).toBe(1);
    });

    it("should handle empty users list", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Users fetched successfully",
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 50,
          totalPages: 0,
        },
      };

      (api.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await userService.getAll();

      expect(result.data).toHaveLength(0);
      expect(result.meta?.total).toBe(0);
    });
  });

  describe("getById", () => {
    it("should fetch user by id", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "User fetched successfully",
        data: {
          id: "user-uuid-1",
          username: "john_doe",
          email: "john@example.com",
          status: "ACTIVE",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await userService.getById("user-uuid-1");

      expect(api.post).toHaveBeenCalledWith("/api/v1/users/detail", {
        userId: "user-uuid-1",
      });
      expect(result.id).toBe("user-uuid-1");
      expect(result.username).toBe("john_doe");
    });
  });

  describe("create", () => {
    it("should create user successfully", async () => {
      const mockResponse = {
        success: true,
        status: 201,
        message: "User created successfully",
        data: {
          id: "new-user-uuid",
          username: "new_user",
          email: "new@example.com",
          status: "PENDING",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await userService.create({
        username: "new_user",
        firstName: "New",
        lastName: "User",
        email: "new@example.com",
        password: "password123",
        roleId: "role-uuid-1",
      });

      expect(api.post).toHaveBeenCalledWith("/api/v1/users/create", {
        username: "new_user",
        firstName: "New",
        lastName: "User",
        email: "new@example.com",
        password: "password123",
        roleId: "role-uuid-1",
      });
      expect(result.id).toBe("new-user-uuid");
    });
  });

  describe("update", () => {
    it("should update user successfully", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "User updated successfully",
        data: {
          id: "user-uuid-1",
          username: "updated_user",
          email: "updated@example.com",
          status: "ACTIVE",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      };

      (api.patch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await userService.update({
        userId: "user-uuid-1",
        username: "updated_user",
        email: "updated@example.com",
      });

      expect(api.patch).toHaveBeenCalledWith("/api/v1/users/edit", {
        userId: "user-uuid-1",
        username: "updated_user",
        email: "updated@example.com",
      });
      expect(result.username).toBe("updated_user");
    });
  });

  describe("updateRole", () => {
    it("should update user role", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Role updated successfully",
      });

      await userService.updateRole("user-uuid-1", "role-uuid-2");

      expect(api.post).toHaveBeenCalledWith("/api/v1/users/role-update", {
        userId: "user-uuid-1",
        roleId: "role-uuid-2",
      });
    });
  });

  describe("delete", () => {
    it("should delete user successfully", async () => {
      (api.delete as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "User deleted successfully",
      });

      await userService.delete("user-uuid-1");

      expect(api.delete).toHaveBeenCalledWith(
        "/api/v1/users/delete",
        expect.objectContaining({ params: { userId: "user-uuid-1" } }),
      );
    });
  });

  describe("checkUsername", () => {
    it("should check username availability", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Username check completed",
        data: { username: "available_user", available: true },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await userService.checkUsername("available_user");

      expect(api.post).toHaveBeenCalledWith("/api/v1/users/username-check", {
        username: "available_user",
      });
      expect(result.available).toBe(true);
    });
  });

  describe("uploadAvatar", () => {
    it("should upload avatar", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        message: "Avatar uploaded successfully",
      });

      const mockFile = new File(["test"], "test.png", { type: "image/png" });

      await userService.uploadAvatar("user-uuid-1", mockFile);

      expect(api.post).toHaveBeenCalled();
    });
  });

  describe("deleteAvatar", () => {
    it("should delete avatar", async () => {
      (api.delete as jest.Mock).mockResolvedValue({
        success: true,
        message: "Avatar deleted successfully",
      });

      await userService.deleteAvatar("user-uuid-1");

      expect(api.delete).toHaveBeenCalledWith(
        "/api/v1/users/user-uuid-1/avatar",
      );
    });
  });
});
