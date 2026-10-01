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
    it("fetches roles from the REST list endpoint (data[] + top-level meta, F-19)", async () => {
      const mockResponse = {
        success: true,
        data: [role(), role({ id: "e50b664b-451c-45a9-8c83-f65b94a8afdf", name: "WAREHOUSE STAFF", nameToShow: "Gudang" })],
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
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
        meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
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
    it("F-19: creates a role via POST /roles with every field the dialog offers", async () => {
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
        nameToShow: "Manager",
        roleLevel: 3,
        status: "active",
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

  describe("F-19: a row's status is the source of isActive", () => {
    it("derives isActive from status on list, get, create and update", async () => {
      (api.get as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: [{ id: "a", name: "A", status: "active" }, { id: "b", name: "B", status: "inactive" }],
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });
      const list = await roleService.getAll();
      expect(list.data.map((r) => r.isActive)).toEqual([true, false]);

      (api.get as jest.Mock).mockResolvedValueOnce({ success: true, data: { id: "b", name: "B", status: "inactive" } });
      expect((await roleService.getById("b")).isActive).toBe(false);

      (api.post as jest.Mock).mockResolvedValueOnce({ success: true, data: { id: "c", name: "C", status: "inactive" } });
      expect((await roleService.create({ name: "C", isActive: false })).isActive).toBe(false);
      expect((api.post as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({ status: "inactive" }));

      (api.patch as jest.Mock).mockResolvedValueOnce({ success: true, data: { id: "c", name: "C", status: "active" } });
      const updated = await roleService.update({ id: "c", nameToShow: "", roleLevel: 4 });
      expect(updated.isActive).toBe(true);
      expect((api.patch as jest.Mock).mock.calls[0][1]).toEqual({ nameToShow: "", roleLevel: 4 });
    });

    it("keeps a row's own isActive when it carries no status, and the list falls back without meta", async () => {
      (api.get as jest.Mock).mockResolvedValueOnce({ success: true, data: [{ id: "a", name: "A", isActive: true }] });
      const list = await roleService.getAll(1, 20);
      expect(list.data[0].isActive).toBe(true);
      expect(list.meta?.total).toBe(1);
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
