/**
 * Tests for quota.controller.js
 *
 * quota.controller uses asyncHandler but also throws AppError
 * (for 404 when tenant not found), which asyncHandler catches
 * and routes through next().
 */

jest.mock("../../services/quota.service", () => ({
  getUsageSummary: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.message = message;
    }
  },
}));

const quotaService = require("../../services/quota.service");
const quotaController = require("../../controllers/quota.controller");
const { AppError } = require("../../utils/appError.util");
const { success } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("quotaController", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
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

  describe("getUsage", () => {
    it("should return quota usage summary", async () => {
      quotaService.getUsageSummary.mockResolvedValue({
        plan: "professional",
        status: "active",
        features: ["core", "reports", "webhooks"],
        seats: { used: 10, limit: 50 },
        storage: { usedMb: 1024, limitMb: 10240 },
      });

      await quotaController.getUsage(req, res, next);

      expect(quotaService.getUsageSummary).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 404 when tenant not found", async () => {
      quotaService.getUsageSummary.mockResolvedValue(null);

      await quotaController.getUsage(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0] instanceof AppError).toBe(true);
      expect(next.mock.calls[0][0].status).toBe(404);
      expect(next.mock.calls[0][0].message).toBe("Tenant not found");
    });
  });
});
