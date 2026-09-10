/**
 * Tests for Metered Billing Controller
 */

jest.mock("../../services/meteredBilling.service", () => ({
  getTenantUsage: jest.fn(),
  getBillingHistory: jest.fn(),
  estimateCost: jest.fn(),
  getPlanDetails: jest.fn(),
  getUsageAlerts: jest.fn(),
  createUsageAlert: jest.fn(),
  deleteUsageAlert: jest.fn(),
  getAnalytics: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const meteredBillingService = require("../../services/meteredBilling.service");
const meteredBillingController = require("../../controllers/meteredBilling.controller");
const { success, error } = require("../../utils/response.util");

describe("meteredBillingController", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      user: { tenantId: "tenant-123" },
      query: {},
      body: {},
      params: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response, data, message) => {
      response.json({ success: true, data, message });
    });
    error.mockImplementation((response, message, status) => {
      response.status(status).json({ success: false, message });
    });
  });

  describe("getUsageMetrics", () => {
    it("should return usage metrics successfully", async () => {
      const mockMetrics = {
        apiCalls: 1500,
        storageUsed: 524288000,
        activeUsers: 25,
        calibrations: 150,
      };

      meteredBillingService.getTenantUsage.mockResolvedValue(mockMetrics);

      await meteredBillingController.getUsageMetrics(req, res);

      expect(meteredBillingService.getTenantUsage).toHaveBeenCalledWith(
        "tenant-123",
      );
      expect(success).toHaveBeenCalled();
      const callArgs = success.mock.calls[0];
      expect(callArgs[1]).toEqual(mockMetrics);
      expect(callArgs[2]).toBe("Usage metrics retrieved");
    });

    it("should handle service errors", async () => {
      meteredBillingService.getTenantUsage.mockRejectedValue(
        new Error("Database error"),
      );

      await meteredBillingController.getUsageMetrics(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getBillingHistory", () => {
    it("should return billing history with default pagination", async () => {
      const mockHistory = {
        data: [],
        pagination: { page: 1, limit: 20, total: 0 },
      };

      meteredBillingService.getBillingHistory.mockResolvedValue(mockHistory);

      await meteredBillingController.getBillingHistory(req, res);

      expect(meteredBillingService.getBillingHistory).toHaveBeenCalledWith(
        "tenant-123",
        1,
        20,
        undefined,
        undefined,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return billing history with custom pagination", async () => {
      const mockHistory = {
        data: [],
        pagination: { page: 2, limit: 50, total: 100 },
      };

      meteredBillingService.getBillingHistory.mockResolvedValue(mockHistory);

      req.query = {
        page: "2",
        limit: "50",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      };

      await meteredBillingController.getBillingHistory(req, res);

      expect(meteredBillingService.getBillingHistory).toHaveBeenCalledWith(
        "tenant-123",
        2,
        50,
        "2024-01-01",
        "2024-12-31",
      );
    });
  });

  describe("estimateCost", () => {
    it("should return cost estimate successfully", async () => {
      const mockEstimate = {
        estimatedCost: 150.0,
        currency: "USD",
        breakdown: {
          baseCost: 100.0,
          overageCost: 50.0,
        },
      };

      meteredBillingService.estimateCost.mockResolvedValue(mockEstimate);

      req.body = { metrics: { api_calls: 1000 }, quantity: 100 };

      await meteredBillingController.estimateCost(req, res);

      expect(meteredBillingService.estimateCost).toHaveBeenCalledWith(
        "tenant-123",
        { api_calls: 1000 },
        100,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle missing body parameters", async () => {
      meteredBillingService.estimateCost.mockRejectedValue(
        new Error("Missing required fields"),
      );

      req.body = {};

      await meteredBillingController.estimateCost(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getPlanDetails", () => {
    it("should return plan details successfully", async () => {
      const mockPlan = {
        planName: "professional",
        limits: {
          apiCalls: 100000,
          storageBytes: 10737418240,
          users: 50,
        },
        overagePricing: {
          apiCalls: 0.001,
          storageBytes: 0.0001,
        },
      };

      meteredBillingService.getPlanDetails.mockResolvedValue(mockPlan);

      await meteredBillingController.getPlanDetails(req, res);

      expect(meteredBillingService.getPlanDetails).toHaveBeenCalledWith(
        "tenant-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getUsageAlerts", () => {
    it("should return usage alerts successfully", async () => {
      const mockAlerts = [
        { id: "alert-1", metricName: "api_calls", threshold: 10000 },
        { id: "alert-2", metricName: "storage_bytes", threshold: 10737418240 },
      ];

      meteredBillingService.getUsageAlerts.mockResolvedValue(mockAlerts);

      await meteredBillingController.getUsageAlerts(req, res);

      expect(meteredBillingService.getUsageAlerts).toHaveBeenCalledWith(
        "tenant-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createUsageAlert", () => {
    it("should create a usage alert successfully", async () => {
      const mockAlert = {
        id: "alert-1",
        metricName: "api_calls",
        threshold: 10000,
        isEnabled: true,
      };

      meteredBillingService.createUsageAlert.mockResolvedValue(mockAlert);

      req.body = {
        metricName: "api_calls",
        threshold: 10000,
        comparison: "gte",
        notificationChannels: ["email"],
        isEnabled: true,
      };

      await meteredBillingController.createUsageAlert(req, res);

      expect(meteredBillingService.createUsageAlert).toHaveBeenCalledWith(
        "tenant-123",
        req.body,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteUsageAlert", () => {
    it("should delete a usage alert successfully", async () => {
      meteredBillingService.deleteUsageAlert.mockResolvedValue(true);

      req.params = { alertId: "alert-123" };

      await meteredBillingController.deleteUsageAlert(req, res);

      expect(meteredBillingService.deleteUsageAlert).toHaveBeenCalledWith(
        "tenant-123",
        "alert-123",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle alert not found", async () => {
      meteredBillingService.deleteUsageAlert.mockRejectedValue(
        new Error("Alert not found"),
      );

      req.params = { alertId: "non-existent" };

      await meteredBillingController.deleteUsageAlert(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getAnalytics", () => {
    it("should return analytics with default period", async () => {
      const mockAnalytics = {
        trends: [],
        insights: {
          topMetric: "api_calls",
          growthRate: 15.5,
        },
      };

      meteredBillingService.getAnalytics.mockResolvedValue(mockAnalytics);

      await meteredBillingController.getAnalytics(req, res);

      expect(meteredBillingService.getAnalytics).toHaveBeenCalledWith(
        "tenant-123",
        "30d",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should return analytics with custom period", async () => {
      const mockAnalytics = {
        trends: [],
        insights: {},
      };

      meteredBillingService.getAnalytics.mockResolvedValue(mockAnalytics);

      req.query = { period: "90d" };

      await meteredBillingController.getAnalytics(req, res);

      expect(meteredBillingService.getAnalytics).toHaveBeenCalledWith(
        "tenant-123",
        "90d",
      );
    });
  });
});
