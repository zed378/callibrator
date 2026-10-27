/**
 * Tests for audit.controller.ts
 */
import type { Request, Response } from "express";

jest.mock("../../services/audit.service", () => ({
  fetchAuditLogs: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface AuditServiceDouble {
    fetchAuditLogs: jest.Mock;
}

interface ResponseDouble {
    success: jest.Mock;
}

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;

interface FakeRes {
    status: (code: number) => FakeRes;
    json: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const auditService = require("../../services/audit.service") as AuditServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const auditController = require("../../controllers/audit.controller") as { fetchAuditLogs: Handler };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("auditController", () => {
  let req: Record<string, unknown>;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((response: FakeRes, data: unknown, meta: unknown, message: unknown, status?: number) => {
      response.status(status ?? 200).json({ success: true, data, meta, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: { id: "user-1", tenantId: VALID_TENANT_ID },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("fetchAuditLogs", () => {
    it("should return paginated audit logs with default pagination", async () => {
      auditService.fetchAuditLogs.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch audit logs successful",
        data: {
          rows: [{ id: "log-1", action: "login", resourceType: "user" }],
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      });

      await auditController.fetchAuditLogs(req as unknown as Request, res as unknown as Response, next);

      expect(auditService.fetchAuditLogs).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        page: undefined,
        limit: undefined,
        userId: undefined,
        action: undefined,
        resourceType: undefined,
        resourceId: undefined,
        startDate: undefined,
        endDate: undefined,
      });
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should filter by query parameters", async () => {
      auditService.fetchAuditLogs.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch audit logs successful",
        data: {
          rows: [],
          meta: { total: 0, page: 2, limit: 5, totalPages: 0 },
        },
      });

      req["query"] = {
        page: "2",
        limit: "5",
        userId: "user-1",
        action: "logout",
        resourceType: "device",
        resourceId: "device-1",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      };

      await auditController.fetchAuditLogs(req as unknown as Request, res as unknown as Response, next);

      expect(auditService.fetchAuditLogs).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        page: "2",
        limit: "5",
        userId: "user-1",
        action: "logout",
        resourceType: "device",
        resourceId: "device-1",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
      expect(success).toHaveBeenCalled();
    });

    it("should handle service error", async () => {
      auditService.fetchAuditLogs.mockResolvedValue({
        success: false,
        status: 500,
        message: "Failed to fetch audit logs",
        data: { rows: [], meta: {} },
      });

      await auditController.fetchAuditLogs(req as unknown as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
