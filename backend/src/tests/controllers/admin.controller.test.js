/**
 * Tests for admin controller
 */

jest.mock("../../services/admin.service", () => ({
  getAllTenants: jest.fn(),
  updateTenantStatus: jest.fn(),
  updateTenantFlags: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.statusCode = status;
    }
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const adminService = require("../../services/admin.service");
const adminController = require("../../controllers/admin.controller");
const { error: sendError } = require("../../utils/response.util");

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("admin Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getAllTenants", () => {
    it("should return all tenants without filters", async () => {
      adminService.getAllTenants.mockResolvedValue([
        { id: "tenant-1", name: "Tenant A" },
      ]);

      await adminController.getAllTenants(req, res, next);

      expect(adminService.getAllTenants).toHaveBeenCalledWith(undefined, undefined, undefined);
    });

    it("should return tenants with search filter", async () => {
      req.query = { search: "hospital" };
      adminService.getAllTenants.mockResolvedValue([]);

      await adminController.getAllTenants(req, res, next);

      expect(adminService.getAllTenants).toHaveBeenCalledWith(undefined, undefined, "hospital");
    });

    it("should return tenants with pagination", async () => {
      req.query = { page: "2", limit: "50" };
      adminService.getAllTenants.mockResolvedValue([]);

      await adminController.getAllTenants(req, res, next);

      // Query params come as strings from URL
      expect(adminService.getAllTenants).toHaveBeenCalledWith("2", "50", undefined);
    });
  });

  describe("updateTenantStatus", () => {
    it("should update tenant status", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { status: "ACTIVE" };
      adminService.updateTenantStatus.mockResolvedValue({ id: VALID_TENANT_ID, status: "ACTIVE" });

      await adminController.updateTenantStatus(req, res, next);

      expect(adminService.updateTenantStatus).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        "ACTIVE",
      );
    });

    it("should return 404 when tenant not found", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { status: "ACTIVE" };
      adminService.updateTenantStatus.mockRejectedValue(new Error("Tenant not found"));

      await adminController.updateTenantStatus(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Tenant not found", 404);
    });

    it("should return 400 for invalid status", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { status: "INVALID_STATUS" };
      adminService.updateTenantStatus.mockRejectedValue(new Error("Invalid status"));

      await adminController.updateTenantStatus(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Invalid status", 400);
    });
  });

  describe("updateTenantFlags", () => {
    it("should update tenant flags", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { flags: { ssoEnabled: true, auditLogEnabled: false } };
      adminService.updateTenantFlags.mockResolvedValue({
        id: VALID_TENANT_ID,
        flags: { ssoEnabled: true, auditLogEnabled: false },
      });

      await adminController.updateTenantFlags(req, res, next);

      expect(adminService.updateTenantFlags).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        { ssoEnabled: true, auditLogEnabled: false },
      );
    });

    it("should return 404 when tenant not found", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { flags: { ssoEnabled: true } };
      adminService.updateTenantFlags.mockRejectedValue(new Error("Tenant not found"));

      await adminController.updateTenantFlags(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Tenant not found", 404);
    });
  });
});
