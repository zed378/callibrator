/**
 * Tests for tenantUpload.service.js
 */

// Mock appError first with proper constructor signature matching service usage
jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(message, status, isOperational, details) {
      // Handle both (status, message) and (message, status) signatures
      let actualStatus, actualMessage;
      if (typeof message === "number") {
        actualStatus = message;
        actualMessage = status;
      } else {
        actualMessage = message;
        actualStatus = status;
      }
      super(actualMessage);
      this.name = "AppError";
      this.status = actualStatus || 500;
      this.isOperational = isOperational !== false;
    }
  }
  return { AppError };
});

// Mock dependencies before importing service
jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
  getUploadUrl: jest.fn((filename, folder) => `/${folder}/${filename}`),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../models", () => ({
  Tenants: {
    findByPk: jest.fn(),
  },
}));

const { deleteUpload, getUploadUrl } = require("../../utils/upload.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const { AppError } = require("../../utils/appError.util");
const {
  updateTenantLogo,
  removeTenantLogo,
} = require("../../services/tenantUpload.service");
const { Tenants } = require("../../models");

describe("tenantUpload.service", () => {
  const mockTenant = {
    id: "tenant-123",
    logo: "old-logo.png",
    update: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Tenants.findByPk.mockResolvedValue(mockTenant);
    deleteUpload.mockResolvedValue(undefined);
    getUploadUrl.mockImplementation(
      (filename, folder) => `/${folder}/${filename}`,
    );
  });

  describe("updateTenantLogo", () => {
    it("should update tenant logo successfully", async () => {
      const result = await updateTenantLogo(
        "tenant-123",
        "new-logo.png",
        "user-456",
      );

      expect(deleteUpload).toHaveBeenCalledWith(
        "old-logo.png",
        "uploads/tenant",
      );
      expect(mockTenant.update).toHaveBeenCalledWith(
        { logo: "new-logo.png" },
        { silent: true },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "Tenant logo updated: tenant-123 by user-456",
      );
      expect(result).toEqual({
        data: { logo: "new-logo.png" },
        message: "Tenant logo updated successfully",
        status: 200,
      });
    });

    it("should handle tenant without existing logo", async () => {
      Tenants.findByPk.mockResolvedValue({
        ...mockTenant,
        logo: null,
      });

      const result = await updateTenantLogo(
        "tenant-123",
        "new-logo.png",
        "user-456",
      );

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockTenant.update).toHaveBeenCalledWith(
        { logo: "new-logo.png" },
        { silent: true },
      );
      expect(result).toEqual({
        data: { logo: "new-logo.png" },
        message: "Tenant logo updated successfully",
        status: 200,
      });
    });

    it("should throw 404 when tenant not found", async () => {
      Tenants.findByPk.mockResolvedValue(null);

      await expect(
        updateTenantLogo("invalid-id", "new-logo.png", "user-456"),
      ).rejects.toThrow("Tenant not found");
    });

    it("should continue if old logo deletion fails", async () => {
      deleteUpload.mockRejectedValue(new Error("File not found"));

      const result = await updateTenantLogo(
        "tenant-123",
        "new-logo.png",
        "user-456",
      );

      expect(logger.warn).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw InternalServerError if a non-AppError occurs", async () => {
      mockTenant.update.mockRejectedValueOnce(new Error("Database connection failed"));

      await expect(
        updateTenantLogo("tenant-123", "new-logo.png", "user-456"),
      ).rejects.toThrow("Failed to update tenant logo");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("removeTenantLogo", () => {
    it("should remove tenant logo successfully", async () => {
      const result = await removeTenantLogo("tenant-123", "user-456");

      expect(deleteUpload).toHaveBeenCalledWith(
        "old-logo.png",
        "uploads/tenant",
      );
      expect(mockTenant.update).toHaveBeenCalledWith(
        { logo: null },
        { silent: true },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "Tenant logo removed: tenant-123 by user-456",
      );
      expect(result).toEqual({
        data: { logo: null },
        message: "Tenant logo removed successfully",
        status: 200,
      });
    });

    it("should do nothing if tenant has no logo", async () => {
      Tenants.findByPk.mockResolvedValue({
        ...mockTenant,
        logo: null,
      });

      const result = await removeTenantLogo("tenant-123", "user-456");

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockTenant.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: { logo: null },
        message: "Tenant logo removed successfully",
        status: 200,
      });
    });

    it("should throw 404 when tenant not found", async () => {
      Tenants.findByPk.mockResolvedValue(null);

      await expect(removeTenantLogo("invalid-id", "user-456")).rejects.toThrow(
        "Tenant not found",
      );
    });

    it("should continue if logo deletion fails", async () => {
      deleteUpload.mockRejectedValue(new Error("File not found"));

      const result = await removeTenantLogo("tenant-123", "user-456");

      expect(logger.warn).toHaveBeenCalled();
      expect(result.data.logo).toBeNull();
    });

    it("should throw InternalServerError if a non-AppError occurs", async () => {
      mockTenant.update.mockRejectedValueOnce(new Error("Database connection failed"));

      await expect(
        removeTenantLogo("tenant-123", "user-456"),
      ).rejects.toThrow("Failed to remove tenant logo");

      expect(logger.error).toHaveBeenCalled();
    });
    it("should not delete logo if it is default.svg", async () => {
      Tenants.findByPk.mockResolvedValue({
        ...mockTenant,
        logo: "path/to/default.svg",
      });

      const result = await removeTenantLogo("tenant-123", "user-456");

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockTenant.update).toHaveBeenCalledWith(
        { logo: null },
        { silent: true },
      );
    });

    it("should not delete logo if it resolves to a falsy filename in updateTenantLogo", async () => {
      Tenants.findByPk.mockResolvedValue({
        ...mockTenant,
        logo: "/",
      });

      const result = await updateTenantLogo(
        "tenant-123",
        "new-logo.png",
        "user-456",
      );

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should not delete logo if it resolves to a falsy filename in removeTenantLogo", async () => {
      Tenants.findByPk.mockResolvedValue({
        ...mockTenant,
        logo: "/",
      });

      const result = await removeTenantLogo("tenant-123", "user-456");

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});
