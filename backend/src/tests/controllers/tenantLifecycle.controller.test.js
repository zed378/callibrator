/**
 * Tests for tenantLifecycle controller
 */

jest.mock("../../services/tenantLifecycle.service", () => ({
  suspendTenant: jest.fn(),
  resumeTenant: jest.fn(),
  enterGracePeriod: jest.fn(),
  offboardTenant: jest.fn(),
  cancelOffboarding: jest.fn(),
  getTenantLifecycleStatus: jest.fn(),
  exportTenantData: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../validators/tenantLifecycle.validator", () => {
  const validate = jest.fn((data, schema) => {
    if (data && data.tenantId && data.tenantId.length === 36) {
      if (schema === suspendTenantSchema) {
        if (data.reason) {
          return { tenantId: data.tenantId, reason: data.reason };
        }
        throw { status: 400, message: "Validation failed" };
      }
      return { tenantId: data.tenantId };
    }
    throw { status: 400, message: "Validation failed" };
  });
  const suspendTenantSchema = {};
  const tenantIdSchema = {};
  return { validate, tenantIdSchema, suspendTenantSchema };
});

const tenantLifecycleController = require("../../controllers/tenantLifecycle.controller");
const tenantLifecycleService = require("../../services/tenantLifecycle.service");
const { validate, suspendTenantSchema } = require("../../validators/tenantLifecycle.validator");
const { success, error } = require("../../utils/response.util");

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("tenantLifecycle Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    validate.mockImplementation((data, schema) => {
      if (data && data.tenantId && data.tenantId.length === 36) {
        if (schema === suspendTenantSchema) {
          if (data.reason) {
            return { tenantId: data.tenantId, reason: data.reason };
          }
          throw { status: 400, message: "Validation failed" };
        }
        return { tenantId: data.tenantId };
      }
      throw { status: 400, message: "Validation failed" };
    });
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

  describe("suspendTenant", () => {
    it("should suspend a tenant", async () => {
      req.body = { tenantId: TENANT_ID, reason: "Payment overdue" };
      tenantLifecycleService.suspendTenant.mockResolvedValue({ id: TENANT_ID, status: "SUSPENDED" });

      await tenantLifecycleController.suspendTenant(req, res, next);

      expect(tenantLifecycleService.suspendTenant).toHaveBeenCalledWith(
        TENANT_ID,
        "Payment overdue",
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on invalid tenantId", async () => {
      req.body = { tenantId: "not-a-uuid", reason: "test" };

      await tenantLifecycleController.suspendTenant(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("resumeTenant", () => {
    it("should resume a tenant", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.resumeTenant.mockResolvedValue({ id: TENANT_ID, status: "ACTIVE" });

      await tenantLifecycleController.resumeTenant(req, res, next);

      expect(tenantLifecycleService.resumeTenant).toHaveBeenCalledWith(
        TENANT_ID,
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on invalid tenantId", async () => {
      req.params = { tenantId: "invalid" };

      await tenantLifecycleController.resumeTenant(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("enterGracePeriod", () => {
    it("should enter grace period", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.enterGracePeriod.mockResolvedValue({ id: TENANT_ID, gracePeriodExpiresAt: new Date() });

      await tenantLifecycleController.enterGracePeriod(req, res, next);

      expect(tenantLifecycleService.enterGracePeriod).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("offboardTenant", () => {
    it("should offboard a tenant", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.offboardTenant.mockResolvedValue({ id: TENANT_ID, status: "OFFBOARDED" });

      await tenantLifecycleController.offboardTenant(req, res, next);

      expect(tenantLifecycleService.offboardTenant).toHaveBeenCalledWith(TENANT_ID, false);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("cancelOffboarding", () => {
    it("should cancel offboarding", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.cancelOffboarding.mockResolvedValue({ id: TENANT_ID, status: "ACTIVE" });

      await tenantLifecycleController.cancelOffboarding(req, res, next);

      expect(tenantLifecycleService.cancelOffboarding).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getTenantLifecycleStatus", () => {
    it("should return lifecycle status", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.getTenantLifecycleStatus.mockResolvedValue({
        status: "ACTIVE",
        gracePeriodExpired: false,
      });

      await tenantLifecycleController.getTenantLifecycleStatus(req, res, next);

      expect(tenantLifecycleService.getTenantLifecycleStatus).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("exportTenantData", () => {
    it("should export tenant data", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.exportTenantData.mockResolvedValue({
        tenant: { id: TENANT_ID },
        users: [],
        exportedAt: new Date(),
      });

      await tenantLifecycleController.exportTenantData(req, res, next);

      expect(tenantLifecycleService.exportTenantData).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });
});
