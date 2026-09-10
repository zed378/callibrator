/**
 * Tests for Admin Service
 */

jest.mock("../../models", () => ({
  Tenants: {
    findAndCountAll: jest.fn(),
    findByPk: jest.fn(),
  },
  Users: {
    findByPk: jest.fn(),
  },
  Role: {
    findByPk: jest.fn(),
  },
}));

jest.mock("../../utils/appError.util", () => {
  return {
    AppError: class AppError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  };
});

const adminService = require("../../services/admin.service");
const { Tenants, Users, Role } = require("../../models");
const { AppError } = require("../../utils/appError.util");

describe("adminService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAllTenants", () => {
    it("should apply page/limit/search defaults when called with no arguments", async () => {
      Tenants.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const result = await adminService.getAllTenants();

      // page = 1, limit = 10, search = "" come from parameter defaults.
      expect(Tenants.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, limit: 10, offset: 0 }),
      );
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it("should return paginated tenants without search", async () => {
      const page = 1;
      const limit = 10;
      const mockTenants = [
        { id: "t-1", name: "Tenant 1" },
        { id: "t-2", name: "Tenant 2" },
      ];

      Tenants.findAndCountAll.mockResolvedValueOnce({
        count: 2,
        rows: mockTenants,
      });

      const result = await adminService.getAllTenants(page, limit);

      expect(Tenants.findAndCountAll).toHaveBeenCalledWith({
        where: {},
        limit,
        offset: 0,
        order: [["createdAt", "DESC"]],
      });

      expect(result).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        tenants: mockTenants,
      });
    });

    it("should return paginated tenants with search", async () => {
      const page = 1;
      const limit = 10;
      const search = "test";
      const mockTenants = [{ id: "t-1", name: "Test Tenant" }];

      Tenants.findAndCountAll.mockResolvedValueOnce({
        count: 1,
        rows: mockTenants,
      });

      const result = await adminService.getAllTenants(page, limit, search);

      const { Op } = require("sequelize");
      expect(Tenants.findAndCountAll).toHaveBeenCalledWith({
        where: {
          [Op.or]: [
            { name: { [Op.iLike]: "%test%" } },
            { code: { [Op.iLike]: "%test%" } },
          ],
        },
        limit,
        offset: 0,
        order: [["createdAt", "DESC"]],
      });

      expect(result).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        tenants: mockTenants,
      });
    });

    it("should calculate correct offset for page 2", async () => {
      const page = 2;
      const limit = 10;

      Tenants.findAndCountAll.mockResolvedValueOnce({
        count: 25,
        rows: [],
      });

      await adminService.getAllTenants(page, limit);

      expect(Tenants.findAndCountAll).toHaveBeenCalledWith({
        where: {},
        limit: 10,
        offset: 10,
        order: [["createdAt", "DESC"]],
      });
    });

    it("should calculate totalPages correctly", async () => {
      const page = 1;
      const limit = 10;

      Tenants.findAndCountAll.mockResolvedValueOnce({
        count: 25,
        rows: [],
      });

      const result = await adminService.getAllTenants(page, limit);

      expect(result.totalPages).toBe(3);
    });

    it("should return correct page and limit as numbers", async () => {
      Tenants.findAndCountAll.mockResolvedValueOnce({
        count: 0,
        rows: [],
      });

      const result = await adminService.getAllTenants("1", "5");

      expect(result.page).toBe(1);
      expect(result.limit).toBe(5);
    });
  });

  describe("updateTenantStatus", () => {
    it("should update tenant status to suspended", async () => {
      const tenantId = "tenant-1";
      const status = "suspended";
      const mockTenant = {
        id: tenantId,
        status: "active",
        settings: {},
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      const result = await adminService.updateTenantStatus(tenantId, status);

      expect(Tenants.findByPk).toHaveBeenCalledWith(tenantId);
      expect(mockTenant.save).toHaveBeenCalled();
      expect(result.status).toBe(status);
    });

    it("should update tenant status to active", async () => {
      const tenantId = "tenant-1";
      const status = "active";
      const mockTenant = {
        id: tenantId,
        status: "suspended",
        settings: {},
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      const result = await adminService.updateTenantStatus(tenantId, status);

      expect(result.status).toBe(status);
    });

    it("should update tenant status to deleted", async () => {
      const tenantId = "tenant-1";
      const status = "deleted";
      const mockTenant = {
        id: tenantId,
        status: "active",
        settings: {},
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      const result = await adminService.updateTenantStatus(tenantId, status);

      expect(result.status).toBe(status);
    });

    it("should throw AppError when tenant not found", async () => {
      const tenantId = "nonexistent";
      const status = "suspended";

      Tenants.findByPk.mockResolvedValueOnce(null);

      await expect(
        adminService.updateTenantStatus(tenantId, status),
      ).rejects.toThrow("Tenant not found");
      await expect(
        adminService.updateTenantStatus(tenantId, status),
      ).rejects.toHaveProperty("status", 404);
    });

    it("should throw AppError for invalid status", async () => {
      const tenantId = "tenant-1";
      const status = "invalid-status";
      const mockTenant = {
        id: tenantId,
        status: "active",
        settings: {},
        save: jest.fn().mockResolvedValue(true),
      };

      // The service throws on first call, so each expect needs its own mock
      Tenants.findByPk.mockResolvedValue(mockTenant);

      await expect(adminService.updateTenantStatus(tenantId, status)).rejects.toThrow("Invalid status");
      await expect(adminService.updateTenantStatus(tenantId, status)).rejects.toBeInstanceOf(AppError);
      await expect(adminService.updateTenantStatus(tenantId, status)).rejects.toHaveProperty("status", 400);
    });
  });

  describe("updateTenantFlags", () => {
    it("should merge flags with existing settings", async () => {
      const tenantId = "tenant-1";
      const flags = { featureA: true };
      const mockTenant = {
        id: tenantId,
        settings: { featureB: false },
        changed: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      const result = await adminService.updateTenantFlags(tenantId, flags);

      expect(mockTenant.settings).toEqual({
        featureB: false,
        featureA: true,
      });
      expect(mockTenant.changed).toHaveBeenCalledWith("settings", true);
      expect(mockTenant.save).toHaveBeenCalled();
    });

    it("should initialize settings if not present", async () => {
      const tenantId = "tenant-1";
      const flags = { featureA: true };
      const mockTenant = {
        id: tenantId,
        settings: null,
        changed: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      const result = await adminService.updateTenantFlags(tenantId, flags);

      expect(mockTenant.settings).toEqual({ featureA: true });
      expect(mockTenant.changed).toHaveBeenCalledWith("settings", true);
    });

    it("should merge multiple flags", async () => {
      const tenantId = "tenant-1";
      const flags = { featureA: true, featureB: false, featureC: true };
      const mockTenant = {
        id: tenantId,
        settings: {},
        changed: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      await adminService.updateTenantFlags(tenantId, flags);

      expect(mockTenant.settings).toEqual(flags);
    });

    it("should throw AppError when tenant not found", async () => {
      const tenantId = "nonexistent";
      const flags = { featureA: true };

      Tenants.findByPk.mockResolvedValueOnce(null);
      Tenants.findByPk.mockResolvedValueOnce(null);

      await expect(
        adminService.updateTenantFlags(tenantId, flags),
      ).rejects.toThrow("Tenant not found");
      await expect(
        adminService.updateTenantFlags(tenantId, flags),
      ).rejects.toHaveProperty("status", 404);
    });

    it("should overwrite existing flag values", async () => {
      const tenantId = "tenant-1";
      const flags = { featureA: true };
      const mockTenant = {
        id: tenantId,
        settings: { featureA: false },
        changed: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      Tenants.findByPk.mockResolvedValueOnce(mockTenant);

      await adminService.updateTenantFlags(tenantId, flags);

      expect(mockTenant.settings).toEqual({ featureA: true });
    });
  });
});
