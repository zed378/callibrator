/**
 * Tests for dashboard.controller.ts
 */

jest.mock("../../services/dashboard.service", () => ({
  getDashboardMetrics: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../constants/roleConstants", () => ({
  ROLE_NAMES: { SUPER_ADMIN: "SUPER_ADMIN" },
}));

interface FakeUser {
  id: string;
  tenantId: string;
  role: { name: string };
}

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user: FakeUser;
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

interface DashboardServiceDouble {
  getDashboardMetrics: jest.Mock;
}

interface DashboardControllerDouble {
  getDashboardMetrics: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
}

interface ResponseUtilDouble {
  success: jest.Mock;
}

interface DashboardCacheServiceDouble {
  clearDashboardCache: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const dashboardService = require("../../services/dashboard.service") as DashboardServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const dashboardController = require("../../controllers/dashboard.controller") as DashboardControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseUtilDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { clearDashboardCache } = require("../../services/dashboardCache.service") as DashboardCacheServiceDouble;

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("dashboardController", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // U-06b (ADR-120): each case observes the service call, so none is answered from the 30 s cache.
    clearDashboardCache();
    success.mockImplementation((resObj: FakeRes, data: unknown, _meta: unknown, message: string, status?: number) => {
      (resObj.status(status ?? 200) as FakeRes).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
        role: { name: "USER" },
      },
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getDashboardMetrics", () => {
    it("should return tenant-scoped metrics for non-super-admin", async () => {
      dashboardService.getDashboardMetrics.mockResolvedValue({
        success: true,
        status: 200,
        message: "Dashboard metrics fetched successfully",
        data: {
          scope: "tenant",
          users: { total: 10, verified: 8 },
          devices: { total: 5, dueSoon: 2, overdue: 0 },
          calibrations: { total: 20, compliant: 18 },
          certificates: { total: 15, byStatus: {} },
          inventory: { stockItems: 100, warehouses: 2 },
          maintenance: { openWorkOrders: 3 },
        },
      });

      await dashboardController.getDashboardMetrics(req, res, next);

      expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return global metrics for SUPER_ADMIN", async () => {
      req.user.role.name = "SUPER_ADMIN";
      dashboardService.getDashboardMetrics.mockResolvedValue({
        success: true,
        status: 200,
        message: "Dashboard metrics fetched successfully",
        data: {
          scope: "global",
          tenants: { total: 5, active: 4 },
          tenantBreakdown: [],
        },
      });

      await dashboardController.getDashboardMetrics(req, res, next);

      expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(null);
      expect(success).toHaveBeenCalled();
    });

    it("should return tenant-scoped metrics for SUPER_ADMIN with tenantId query param", async () => {
      const targetTenantId = "550e8400-e29b-41d4-a716-446655440099";
      req.user.role.name = "SUPER_ADMIN";
      req.query["tenantId"] = targetTenantId;
      dashboardService.getDashboardMetrics.mockResolvedValue({
        success: true,
        status: 200,
        message: "Dashboard metrics fetched successfully",
        data: { scope: "tenant" },
      });

      await dashboardController.getDashboardMetrics(req, res, next);

      expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(targetTenantId);
      expect(success).toHaveBeenCalled();
    });

    it("should return tenant-scoped metrics when SUPER_ADMIN has no tenantId query param", async () => {
      req.user.role.name = "SUPER_ADMIN";
      dashboardService.getDashboardMetrics.mockResolvedValue({
        success: true,
        status: 200,
        message: "Dashboard metrics fetched successfully",
        data: { scope: "global" },
      });

      await dashboardController.getDashboardMetrics(req, res, next);

      expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(null);
      expect(success).toHaveBeenCalled();
    });

    it("should handle service error", async () => {
      dashboardService.getDashboardMetrics.mockResolvedValue({
        success: false,
        status: 500,
        message: "Failed to fetch dashboard metrics",
        data: {},
      });

      await dashboardController.getDashboardMetrics(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
