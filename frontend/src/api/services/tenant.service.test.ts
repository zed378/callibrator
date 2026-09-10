import { tenantService } from "./tenant.service";
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

describe("tenantService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAll", () => {
    it("should fetch tenants with pagination following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Tenants fetched successfully",
        data: [
          {
            id: "tenant-uuid-1",
            name: "Acme Hospital",
            code: "ACME",
            description: "Acme Medical Center",
            logo: "https://example.com/logo.png",
            status: "ACTIVE",
            maxUsers: 100,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        },
      };

      (api.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await tenantService.getAll(1, 25, "acme");

      expect(api.get).toHaveBeenCalledWith("/api/v1/tenants/all", {
        params: { page: 1, limit: 25, find: "acme" },
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Acme Hospital");
      expect(result.data[0].code).toBe("ACME");
    });

    it("should handle empty tenants list", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Tenants fetched successfully",
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: 25,
          totalPages: 0,
        },
      };

      (api.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await tenantService.getAll();

      expect(result.data).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("should fetch tenant by id following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Tenant fetched successfully",
        data: {
          id: "tenant-uuid-1",
          name: "Acme Hospital",
          code: "ACME",
          description: "Acme Medical Center",
          logo: "https://example.com/logo.png",
          status: "ACTIVE",
          maxUsers: 100,
          settings: { theme: "light" },
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await tenantService.getById("tenant-uuid-1");

      expect(api.post).toHaveBeenCalledWith("/api/v1/tenants/detail", {
        tenantId: "tenant-uuid-1",
      });
      expect(result.id).toBe("tenant-uuid-1");
      expect(result.name).toBe("Acme Hospital");
    });
  });

  describe("create", () => {
    it("should create tenant successfully following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 201,
        message: "Tenant created successfully",
        data: {
          id: "new-tenant-uuid",
          name: "New Hospital",
          code: "NEW",
          description: "New Medical Center",
          logo: "https://example.com/new-logo.png",
          status: "ACTIVE",
          maxUsers: 50,
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-03T00:00:00Z",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await tenantService.create({
        name: "New Hospital",
        code: "NEW",
        description: "New Medical Center",
        maxUsers: 50,
      });

      // Content-Type is intentionally NOT set — the browser adds the multipart
      // boundary itself (the client interceptor strips it for FormData).
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/tenants/create",
        expect.any(FormData),
      );
      expect(result.name).toBe("New Hospital");
      expect(result.code).toBe("NEW");
    });
  });

  describe("update", () => {
    it("should update tenant successfully following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Tenant updated successfully",
        data: {
          id: "tenant-uuid-1",
          name: "Updated Hospital",
          code: "UPD",
          description: "Updated Medical Center",
          logo: "https://example.com/updated-logo.png",
          status: "ACTIVE",
          maxUsers: 200,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-15T00:00:00Z",
        },
      };

      (api.patch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await tenantService.update({
        tenantId: "tenant-uuid-1",
        name: "Updated Hospital",
        code: "UPD",
        status: "ACTIVE",
        maxUsers: 200,
      });

      // Content-Type is intentionally NOT set (browser sets the multipart boundary).
      expect(api.patch).toHaveBeenCalledWith(
        "/api/v1/tenants/edit",
        expect.any(FormData),
      );
      expect(result.name).toBe("Updated Hospital");
      expect(result.maxUsers).toBe(200);
    });
  });

  describe("delete", () => {
    it("should delete tenant successfully", async () => {
      (api.delete as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Tenant deleted successfully",
      });

      await tenantService.delete("tenant-uuid-1");

      expect(api.delete).toHaveBeenCalledWith(
        "/api/v1/tenants/delete",
        expect.objectContaining({ params: { tenantId: "tenant-uuid-1" } }),
      );
    });
  });

  describe("getSettings", () => {
    it("should get tenant settings", async () => {
      const mockResponse = {
        success: true,
        data: {
          tenant: { id: "tenant-uuid-1", name: "Tenant One" },
          settings: {
            theme: "dark",
            language: "en",
            notifications: true,
          },
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await tenantService.getSettings("tenant-uuid-1");

      expect(api.post).toHaveBeenCalledWith("/api/v1/tenants/settings", {
        tenantId: "tenant-uuid-1",
      });
      expect(result.settings.theme).toBe("dark");
    });
  });

  describe("updateSettings", () => {
    it("should update tenant settings", async () => {
      (api.patch as jest.Mock).mockResolvedValue({
        success: true,
        message: "Settings updated successfully",
      });

      await tenantService.updateSettings("tenant-uuid-1", {
        theme: "light",
        language: "id",
      });

      expect(api.patch).toHaveBeenCalledWith("/api/v1/tenants/settings", {
        tenantId: "tenant-uuid-1",
        settings: { theme: "light", language: "id" },
      });
    });
  });

  describe("getUserCount", () => {
    // The backend envelopes this as data: { tenantId, userCount, maxUsers,
    // remainingSlots }. There is no top-level `count` — reading one always
    // yielded undefined.
    it("should unwrap the seat usage for a tenant", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "ok",
        data: {
          tenantId: "tenant-uuid-1",
          userCount: 42,
          maxUsers: 50,
          remainingSlots: 8,
        },
      });

      const result = await tenantService.getUserCount("tenant-uuid-1");

      expect(api.post).toHaveBeenCalledWith("/api/v1/tenants/user-count", {
        tenantId: "tenant-uuid-1",
      });
      expect(result.userCount).toBe(42);
      expect(result.maxUsers).toBe(50);
      expect(result.remainingSlots).toBe(8);
    });
  });

  describe("uploadLogo", () => {
    it("should upload tenant logo", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        message: "Logo uploaded successfully",
      });

      const mockFile = new File(["logo"], "logo.png", { type: "image/png" });

      await tenantService.uploadLogo("tenant-uuid-1", mockFile);

      expect(api.post).toHaveBeenCalled();
    });
  });

  describe("deleteLogo", () => {
    it("should delete tenant logo", async () => {
      (api.delete as jest.Mock).mockResolvedValue({
        success: true,
        message: "Logo deleted successfully",
      });

      await tenantService.deleteLogo("tenant-uuid-1");

      expect(api.delete).toHaveBeenCalledWith(
        "/api/v1/tenants/tenant-uuid-1/logo",
      );
    });
  });

  // `createBackup` was removed from this service: it duplicated
  // tenantBackupService.create, omitted the required `name` (a guaranteed
  // 400), and returned a `downloadUrl` the endpoint never sends. Backup
  // creation is covered by tenantBackup.service.test.ts.
});
