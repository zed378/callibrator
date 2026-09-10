/**
 * Tests for Metered Billing Validators
 */

const {
  createUsageAlert,
  estimateCost,
  getAnalytics,
  getBillingHistory,
  validate,
  validateBody,
  validateQuery,
} = require("../../validators/meteredBilling.validator");

describe("meteredBillingValidators", () => {
  describe("createUsageAlert", () => {
    it("should validate correct alert data", () => {
      const data = {
        metricName: "api_calls",
        threshold: 10000,
      };

      const result = validate(data, createUsageAlert);
      expect(result.metricName).toBe("api_calls");
      expect(result.threshold).toBe(10000);
      expect(result.isEnabled).toBe(true);
    });

    it("should accept optional notificationChannels", () => {
      const data = {
        metricName: "api_calls",
        threshold: 10000,
        notificationChannels: ["email", "webhook"],
      };

      const result = validate(data, createUsageAlert);
      expect(result.notificationChannels).toEqual(["email", "webhook"]);
    });

    it("should accept optional comparison", () => {
      const data = {
        metricName: "api_calls",
        threshold: 10000,
        comparison: "lte",
      };

      const result = validate(data, createUsageAlert);
      expect(result.comparison).toBe("lte");
    });

    it("should reject missing metricName", () => {
      const data = { threshold: 10000 };

      expect(() => validate(data, createUsageAlert)).toThrow();
    });

    it("should reject missing threshold", () => {
      const data = { metricName: "api_calls" };

      expect(() => validate(data, createUsageAlert)).toThrow();
    });

    it("should reject non-positive threshold", () => {
      const data = { metricName: "api_calls", threshold: -100 };

      expect(() => validate(data, createUsageAlert)).toThrow();
    });

    it("should reject invalid notification channels", () => {
      const data = {
        metricName: "api_calls",
        threshold: 10000,
        notificationChannels: ["invalid"],
      };

      expect(() => validate(data, createUsageAlert)).toThrow();
    });

    it("should reject invalid comparison", () => {
      const data = {
        metricName: "api_calls",
        threshold: 10000,
        comparison: "invalid",
      };

      expect(() => validate(data, createUsageAlert)).toThrow();
    });
  });

  describe("estimateCost", () => {
    it("should validate correct estimation data", () => {
      const data = {
        metrics: { api_calls: 1000 },
        quantity: 100,
      };

      const result = validate(data, estimateCost);
      expect(result.metrics).toEqual({ api_calls: 1000 });
      expect(result.quantity).toBe(100);
    });

    it("should accept optional period", () => {
      const data = {
        metrics: { api_calls: 1000 },
        quantity: 100,
        period: "yearly",
      };

      const result = validate(data, estimateCost);
      expect(result.period).toBe("yearly");
    });

    it("should reject missing metrics", () => {
      const data = { quantity: 100 };

      expect(() => validate(data, estimateCost)).toThrow();
    });

    it("should reject missing quantity", () => {
      const data = { metrics: { api_calls: 1000 } };

      expect(() => validate(data, estimateCost)).toThrow();
    });

    it("should reject non-positive quantity", () => {
      const data = { metrics: { api_calls: 1000 }, quantity: 0 };

      expect(() => validate(data, estimateCost)).toThrow();
    });

    it("should reject invalid period", () => {
      const data = {
        metrics: { api_calls: 1000 },
        quantity: 100,
        period: "invalid",
      };

      expect(() => validate(data, estimateCost)).toThrow();
    });
  });

  describe("getAnalytics", () => {
    it("should validate correct analytics query", () => {
      const data = { period: "30d" };

      const result = validate(data, getAnalytics);
      expect(result.period).toBe("30d");
    });

    it("should accept optional metrics array", () => {
      const data = { period: "90d", metrics: ["api_calls", "storage"] };

      const result = validate(data, getAnalytics);
      expect(result.metrics).toEqual(["api_calls", "storage"]);
    });

    it("should accept all valid periods", () => {
      const periods = ["7d", "30d", "90d", "1y"];

      for (const period of periods) {
        const data = { period };
        const result = validate(data, getAnalytics);
        expect(result.period).toBe(period);
      }
    });

    it("should default to 30d period", () => {
      const data = {};
      const result = validate(data, getAnalytics);
      expect(result.period).toBe("30d");
    });

    it("should reject invalid period", () => {
      const data = { period: "invalid" };

      expect(() => validate(data, getAnalytics)).toThrow();
    });
  });

  describe("getBillingHistory", () => {
    it("should validate correct billing history query", () => {
      const data = { page: 1, limit: 20 };

      const result = validate(data, getBillingHistory);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("should accept optional date range", () => {
      const data = {
        page: 1,
        limit: 50,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      };

      const result = validate(data, getBillingHistory);
      expect(result.startDate.toISOString().slice(0, 10)).toBe("2024-01-01");
      expect(result.endDate.toISOString().slice(0, 10)).toBe("2024-12-31");
    });

    it("should default page to 1", () => {
      const data = {};
      const result = validate(data, getBillingHistory);
      expect(result.page).toBe(1);
    });

    it("should default limit to 20", () => {
      const data = {};
      const result = validate(data, getBillingHistory);
      expect(result.limit).toBe(20);
    });

    it("should reject page less than 1", () => {
      const data = { page: 0 };

      expect(() => validate(data, getBillingHistory)).toThrow();
    });

    it("should reject limit greater than 100", () => {
      const data = { limit: 101 };

      expect(() => validate(data, getBillingHistory)).toThrow();
    });

    it("should reject endDate before startDate", () => {
      const data = {
        startDate: "2024-12-31",
        endDate: "2024-01-01",
      };

      expect(() => validate(data, getBillingHistory)).toThrow();
    });
  });

  describe("validate helper", () => {
    it("should return validated data for valid input", () => {
      const data = { metricName: "api_calls", threshold: 100 };
      const result = validate(data, createUsageAlert);
      expect(result.metricName).toBe("api_calls");
    });

    it("should throw error for invalid input", () => {
      const data = { invalid: "data" };

      expect(() => validate(data, createUsageAlert)).toThrow();
    });
  });

  describe("validateBody middleware", () => {
    it("should call next() for valid body", () => {
      const mockReq = { body: { metricName: "api_calls", threshold: 100 } };
      const mockRes = {};
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.body.metricName).toBe("api_calls");
    });

    it("should pass error to next() for invalid body", () => {
      const mockReq = { body: { invalid: "data" } };
      const mockRes = {};
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(400);
    });

    it("should handle empty body object", () => {
      const mockReq = { body: {} };
      const mockRes = {};
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(400);
    });

    it("should apply default values for missing optional fields", () => {
      const mockReq = { body: { metricName: "api_calls", threshold: 100 } };
      const mockRes = {};
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.body.notificationChannels).toEqual(["email"]);
      expect(mockReq.body.isEnabled).toBe(true);
      expect(mockReq.body.comparison).toBe("gte");
    });
  });

  describe("validateQuery middleware", () => {
    it("should call next() for valid query", () => {
      const mockReq = { query: { period: "30d" } };
      const mockRes = {};
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
    });

    it("should pass error to next() for invalid query", () => {
      const mockReq = { query: { period: "invalid" } };
      const mockRes = {};
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(400);
    });

    it("should handle empty query object", () => {
      const mockReq = { query: {} };
      const mockRes = {};
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
    });

    it("should not modify req.query (read-only)", () => {
      const mockReq = { query: { period: "7d" } };
      const originalQuery = { ...mockReq.query };
      const mockRes = {};
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.query).toEqual(originalQuery);
    });

    it("should use empty object when req.body is undefined", () => {
      const mockReq = {};
      const mockRes = {};
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(400);
    });

    it("should use empty object when req.query is undefined", () => {
      const mockReq = {};
      const mockRes = {};
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
