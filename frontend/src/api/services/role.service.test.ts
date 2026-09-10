import { roleService } from "./role.service";
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

const role = (over = {}) => ({
  id: "6fdd1212-9c4f-45d5-b3bf-5335892be7c0",
  name: "ROOM USER",
  description: "Room User",
  nameToShow: "User Ruangan",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...over,
});

describe("roleService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAll", () => {
    it("fetches roles from the REST list endpoint (data[] + pagination)", async () => {
      const mockResponse = {
        success: true,
        data: [role(), role({ id: "e50b664b-451c-45a9-8c83-f65b94a8afdf", name: "WAREHOUSE STAFF", nameToShow: "Gudang" })],
        pagination: { page: 1, limit: 20, total: 2 },
      };

      (api.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await roleService.getAll(1, 20, "admin");

      expect(api.get).toHaveBeenCalledWith("/api/v1/roles", {
        params: { page: 1, limit: 20, search: "admin" },
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe("ROOM USER");
      expect(result.meta?.page).toBe(1);
      expect(result.meta?.total).toBe(2);
      expect(result.meta?.totalPages).toBe(1);
    });

    it("handles an empty roles list", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        success: true,
        data: [],
        pagination: { page: 1, limit: 20, total: 0 },
      });

      const result = await roleService.getAll();

      expect(result.data).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("fetches a role via GET /roles/:id", async () => {
      (api.get as jest.Mock).mockResolvedValue({ success: true, data: role() });

      const result = await roleService.getById("6fdd1212-9c4f-45d5-b3bf-5335892be7c0");

      expect(api.get).toHaveBeenCalledWith(
        "/api/v1/roles/6fdd1212-9c4f-45d5-b3bf-5335892be7c0",
      );
      expect(result.id).toBe("6fdd1212-9c4f-45d5-b3bf-5335892be7c0");
      expect(result.name).toBe("ROOM USER");
    });

    it("propagates a not-found error", async () => {
      (api.get as jest.Mock).mockRejectedValue({
        response: { status: 404, data: { success: false, message: "Role not found" } },
      });

      await expect(roleService.getById("non-existent-role")).rejects.toBeDefined();
    });
  });

  describe("create", () => {
    it("creates a role via POST /roles with { name, description }", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        data: role({ id: "new-role-uuid", name: "MANAGER", nameToShow: "Manager" }),
      });

      const result = await roleService.create({
        name: "MANAGER",
        description: "Manager role with limited access",
        nameToShow: "Manager",
        isActive: true,
        roleLevel: 3,
      });

      expect(api.post).toHaveBeenCalledWith("/api/v1/roles", {
        name: "MANAGER",
        description: "Manager role with limited access",
      });
      expect(result.name).toBe("MANAGER");
    });
  });

  describe("update", () => {
    it("updates a role via PATCH /roles/:id (id in URL, status derived)", async () => {
      (api.patch as jest.Mock).mockResolvedValue({
        success: true,
        data: role({ id: "role-uuid-1", name: "SUPER_ADMIN" }),
      });

      const result = await roleService.update({
        id: "role-uuid-1",
        name: "SUPER_ADMIN",
        description: "Super Administrator",
        isActive: false,
      });

      expect(api.patch).toHaveBeenCalledWith("/api/v1/roles/role-uuid-1", {
        name: "SUPER_ADMIN",
        description: "Super Administrator",
        status: "inactive",
      });
      expect(result.name).toBe("SUPER_ADMIN");
    });
  });

  describe("delete", () => {
    it("deletes a role via DELETE /roles/:id", async () => {
      (api.delete as jest.Mock).mockResolvedValue({
        success: true,
        message: "Role deleted successfully",
      });

      await roleService.delete("role-uuid-1");

      expect(api.delete).toHaveBeenCalledWith("/api/v1/roles/role-uuid-1");
    });
  });
});
