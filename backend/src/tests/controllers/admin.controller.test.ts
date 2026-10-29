/**
 * Tests for admin controller
 */
import type { Request, Response } from "express";

jest.mock("../../services/admin.service", () => ({
  getAllTenants: jest.fn(),
  updateTenantStatus: jest.fn(),
  updateTenantFlags: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    declare status: number;
    declare statusCode: number;
    constructor(status: number, message: string) {
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

interface AdminServiceDouble {
  getAllTenants: jest.Mock;
  updateTenantStatus: jest.Mock;
  updateTenantFlags: jest.Mock;
}

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;

interface AdminControllerDouble {
  getAllTenants: Handler;
  updateTenantStatus: Handler;
  updateTenantFlags: Handler;
}

interface ResponseDouble {
  error: jest.Mock;
}

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const adminService = require("../../services/admin.service") as AdminServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const adminController = require("../../controllers/admin.controller") as AdminControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { error: sendError } = require("../../utils/response.util") as ResponseDouble;

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

/** One page of tenants, as admin.service#getAllTenants answers it. */
const page = (tenants: Record<string, unknown>[]) => ({
  total: tenants.length,
  page: 1,
  limit: 10,
  totalPages: 1,
  tenants,
});

describe("admin Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

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
      adminService.getAllTenants.mockResolvedValue(page([{ id: "tenant-1", name: "Tenant A" }]));

      await adminController.getAllTenants(req as unknown as Request, res as unknown as Response, next);

      expect(adminService.getAllTenants).toHaveBeenCalledWith(undefined, undefined, undefined);
    });

    it("should return tenants with search filter", async () => {
      req.query = { search: "hospital" };
      adminService.getAllTenants.mockResolvedValue(page([]));

      await adminController.getAllTenants(req as unknown as Request, res as unknown as Response, next);

      expect(adminService.getAllTenants).toHaveBeenCalledWith(undefined, undefined, "hospital");
    });

    it("answers the house list envelope: rows in `data`, paging in a top-level `meta`", async () => {
      const rows = [{ id: "tenant-1", name: "Tenant A" }];
      adminService.getAllTenants.mockResolvedValue({ ...page(rows), total: 11, page: 2, limit: 10, totalPages: 2 });

      await adminController.getAllTenants(req as unknown as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        status: 200,
        message: "Tenants retrieved successfully",
        data: rows,
        meta: { total: 11, page: 2, limit: 10, totalPages: 2 },
      });
    });

    it("should return tenants with pagination", async () => {
      req.query = { page: "2", limit: "50" };
      adminService.getAllTenants.mockResolvedValue(page([]));

      await adminController.getAllTenants(req as unknown as Request, res as unknown as Response, next);

      // Query params come as strings from URL
      expect(adminService.getAllTenants).toHaveBeenCalledWith("2", "50", undefined);
    });
  });

  describe("updateTenantStatus", () => {
    it("should update tenant status", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { status: "ACTIVE" };
      adminService.updateTenantStatus.mockResolvedValue({ id: VALID_TENANT_ID, status: "ACTIVE" });

      await adminController.updateTenantStatus(req as unknown as Request, res as unknown as Response, next);

      expect(adminService.updateTenantStatus).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        "ACTIVE",
        // A-165: the actor, for the audit rows the service writes.
        expect.objectContaining({ userId: VALID_USER_ID, tenantId: VALID_TENANT_ID }),
      );
    });

    it("should return 404 when tenant not found", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { status: "ACTIVE" };
      adminService.updateTenantStatus.mockRejectedValue(new Error("Tenant not found"));

      await adminController.updateTenantStatus(req as unknown as Request, res as unknown as Response, next);

      expect(sendError).toHaveBeenCalledWith(res, "Tenant not found", 404);
    });

    it("should return 400 for invalid status", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { status: "INVALID_STATUS" };
      adminService.updateTenantStatus.mockRejectedValue(new Error("Invalid status"));

      await adminController.updateTenantStatus(req as unknown as Request, res as unknown as Response, next);

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

      await adminController.updateTenantFlags(req as unknown as Request, res as unknown as Response, next);

      expect(adminService.updateTenantFlags).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        { ssoEnabled: true, auditLogEnabled: false },
        expect.objectContaining({ userId: VALID_USER_ID, tenantId: VALID_TENANT_ID }),
      );
    });

    it("should return 404 when tenant not found", async () => {
      req.params = { id: VALID_TENANT_ID };
      req.body = { flags: { ssoEnabled: true } };
      adminService.updateTenantFlags.mockRejectedValue(new Error("Tenant not found"));

      await adminController.updateTenantFlags(req as unknown as Request, res as unknown as Response, next);

      expect(sendError).toHaveBeenCalledWith(res, "Tenant not found", 404);
    });
  });
});
