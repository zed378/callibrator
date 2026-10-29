/**
 * Tests for tenantLifecycle controller
 */
import type { Request, Response, NextFunction } from "express";

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

// The validator module is NOT mocked: the real Zod schemas check every call.

interface TenantLifecycleServiceDouble {
  suspendTenant: jest.Mock;
  resumeTenant: jest.Mock;
  enterGracePeriod: jest.Mock;
  offboardTenant: jest.Mock;
  cancelOffboarding: jest.Mock;
  getTenantLifecycleStatus: jest.Mock;
  exportTenantData: jest.Mock;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

interface TenantLifecycleControllerDouble {
  suspendTenant: Handler;
  resumeTenant: Handler;
  enterGracePeriod: Handler;
  offboardTenant: Handler;
  cancelOffboarding: Handler;
  getTenantLifecycleStatus: Handler;
  exportTenantData: Handler;
}

interface FakeRes {
  status: ((code: number) => FakeRes) & jest.Mock;
  json: jest.Mock;
}

interface MockReq {
  params: Record<string, string | undefined>;
  body: Record<string, unknown> | undefined;
  user?: { id?: string | null | undefined; tenantId?: string | null | undefined } | undefined;
  ip?: string | undefined;
  headers?: Record<string, string | undefined> | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tenantLifecycleController = require("../../controllers/tenantLifecycle.controller") as TenantLifecycleControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tenantLifecycleService = require("../../services/tenantLifecycle.service") as TenantLifecycleServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { success, error } = require("../../utils/response.util") as ResponseDouble;

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS: unknown = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String) as unknown, message: expect.any(String) as unknown }),
]);

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("tenantLifecycle Controller", () => {
  let req: MockReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((resDouble: FakeRes, data: unknown, _meta: unknown, message: unknown, status?: number) => {
      resDouble.status(status ?? 200).json({ success: true, data, message });
    });
    error.mockImplementation((resDouble: FakeRes, message: unknown, statusCode: number) => {
      resDouble.status(statusCode).json({
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

      await tenantLifecycleController.suspendTenant(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.suspendTenant).toHaveBeenCalledWith(
        TENANT_ID,
        "Payment overdue",
        "user-1",
        expect.objectContaining({ userId: "user-1" }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on invalid tenantId", async () => {
      req.body = { tenantId: "not-a-uuid", reason: "test" };

      await tenantLifecycleController.suspendTenant(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.suspendTenant).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 400 when the reason is missing", async () => {
      req.params = { tenantId: TENANT_ID };

      await tenantLifecycleController.suspendTenant(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.suspendTenant).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });

  describe("resumeTenant", () => {
    it("should resume a tenant", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.resumeTenant.mockResolvedValue({ id: TENANT_ID, status: "ACTIVE" });

      await tenantLifecycleController.resumeTenant(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.resumeTenant).toHaveBeenCalledWith(
        TENANT_ID,
        "user-1",
        expect.objectContaining({ userId: "user-1" }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return 400 on invalid tenantId", async () => {
      req.params = { tenantId: "invalid" };

      await tenantLifecycleController.resumeTenant(req as unknown as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("enterGracePeriod", () => {
    it("should enter grace period", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.enterGracePeriod.mockResolvedValue({ id: TENANT_ID, gracePeriodExpiresAt: new Date() });

      await tenantLifecycleController.enterGracePeriod(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.enterGracePeriod).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ userId: "user-1" }));
      expect(success).toHaveBeenCalled();
    });
  });

  describe("offboardTenant", () => {
    it("should offboard a tenant", async () => {
      req.params = { tenantId: TENANT_ID };
      req.ip = "10.0.0.7";
      req.headers = { "user-agent": "ops-console" };
      tenantLifecycleService.offboardTenant.mockResolvedValue({ id: TENANT_ID, status: "OFFBOARDED" });

      await tenantLifecycleController.offboardTenant(req as unknown as Request, res as unknown as Response, next);

      // The operator is passed through as the audit actor (W-04).
      expect(tenantLifecycleService.offboardTenant).toHaveBeenCalledWith(TENANT_ID, false, {
        userId: "user-1",
        ipAddress: "10.0.0.7",
        userAgent: "ops-console",
      });
      expect(success).toHaveBeenCalled();
    });

    it("passes a null actor when the request carries no user", async () => {
      req.params = { tenantId: TENANT_ID };
      req.user = undefined;
      tenantLifecycleService.offboardTenant.mockResolvedValue({ id: TENANT_ID });

      await tenantLifecycleController.offboardTenant(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.offboardTenant).toHaveBeenCalledWith(
        TENANT_ID,
        false,
        expect.objectContaining({ userId: null }),
      );
    });
  });

  describe("cancelOffboarding", () => {
    it("should cancel offboarding", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantLifecycleService.cancelOffboarding.mockResolvedValue({ id: TENANT_ID, status: "ACTIVE" });

      await tenantLifecycleController.cancelOffboarding(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.cancelOffboarding).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ userId: "user-1" }));
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

      await tenantLifecycleController.getTenantLifecycleStatus(req as unknown as Request, res as unknown as Response, next);

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

      await tenantLifecycleController.exportTenantData(req as unknown as Request, res as unknown as Response, next);

      expect(tenantLifecycleService.exportTenantData).toHaveBeenCalledWith(TENANT_ID);
      expect(success).toHaveBeenCalled();
    });
  });
});
