/**
 * Tests for Metered Billing Validators
 *
 * P9-11 (ADR-093): the file's own validate() and validateBody/validateQuery
 * middleware are gone. The schemas are exercised through the shared
 * validateInput (validators/input) and, where the old tests drove the
 * middleware, through the shared validate(schema) / validate(schema,
 * { from: "query" }) middleware the metered-billing routes now mount.
 */
const {
  createUsageAlert,
  estimateCost,
  getAnalytics,
  getBillingHistory,
} = require("../../validators/meteredBilling.validator");
const { validateInput, checkInput } = require("../../validators/input");
const { validate: validateMiddleware } = require("../../middlewares/validation.middleware");

const validate = validateInput;

/**
 * @param {unknown} data - the input
 * @param {import("zod").ZodType} schema - the schema
 * @returns {Array<{field: string, message: string}>} the field errors
 */
const errorsOf = (data, schema) => {
  const result = checkInput(data, schema);
  expect(result.ok).toBe(false);
  return result.errors;
};

/** @returns {{ status: jest.Mock, json: jest.Mock }} a response double */
const mockResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const validateBody = (schema) => validateMiddleware(schema);
const validateQuery = (schema) => validateMiddleware(schema, { from: "query" });

describe("meteredBillingValidators", () => {
  describe("createUsageAlert", () => {
    it("should validate correct alert data", () => {
      const result = validate({ metricName: "api_calls", threshold: 10000 }, createUsageAlert);
      expect(result).toEqual({
        metricName: "api_calls",
        threshold: 10000,
        comparison: "gte",
        notificationChannels: ["email"],
        isEnabled: true,
        description: "",
      });
    });

    it("should accept optional notificationChannels", () => {
      const result = validate(
        { metricName: "api_calls", threshold: 10000, notificationChannels: ["email", "webhook"] },
        createUsageAlert,
      );
      expect(result.notificationChannels).toEqual(["email", "webhook"]);
    });

    it("should accept optional comparison", () => {
      const result = validate({ metricName: "api_calls", threshold: 10000, comparison: "lte" }, createUsageAlert);
      expect(result.comparison).toBe("lte");
    });

    it("should convert a numeric-string threshold and a boolean-string isEnabled", () => {
      const result = validate({ metricName: "api_calls", threshold: "5.5", isEnabled: "false" }, createUsageAlert);
      expect(result.threshold).toBe(5.5);
      expect(result.isEnabled).toBe(false);
    });

    it("should reject missing metricName", () => {
      expect(errorsOf({ threshold: 10000 }, createUsageAlert)).toEqual([
        { field: "metricName", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject an empty metricName", () => {
      expect(errorsOf({ metricName: "", threshold: 1 }, createUsageAlert)).toEqual([
        { field: "metricName", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject missing threshold", () => {
      expect(errorsOf({ metricName: "api_calls" }, createUsageAlert)).toEqual([
        { field: "threshold", message: "Invalid input: expected number, received undefined" },
      ]);
    });

    it("should reject non-positive threshold", () => {
      expect(errorsOf({ metricName: "api_calls", threshold: -100 }, createUsageAlert)).toEqual([
        { field: "threshold", message: "Too small: expected number to be >0" },
      ]);
    });

    it("should reject invalid notification channels", () => {
      expect(
        errorsOf({ metricName: "api_calls", threshold: 10000, notificationChannels: ["invalid"] }, createUsageAlert),
      ).toEqual([{ field: "notificationChannels.0", message: 'Invalid option: expected one of "email"|"webhook"' }]);
    });

    it("should reject invalid comparison", () => {
      expect(errorsOf({ metricName: "api_calls", threshold: 10000, comparison: "invalid" }, createUsageAlert)).toEqual([
        { field: "comparison", message: 'Invalid option: expected one of "gte"|"lte"|"eq"|"gt"|"lt"' },
      ]);
    });

    it("should reject a null description", () => {
      expect(errorsOf({ metricName: "api_calls", threshold: 1, description: null }, createUsageAlert)).toEqual([
        { field: "description", message: "Invalid input: expected string, received null" },
      ]);
    });
  });

  describe("estimateCost", () => {
    it("should validate correct estimation data", () => {
      const result = validate({ metrics: { api_calls: 1000 }, quantity: 100 }, estimateCost);
      expect(result).toEqual({ metrics: { api_calls: 1000 }, quantity: 100, period: "monthly" });
    });

    it("should accept optional period", () => {
      const result = validate({ metrics: { api_calls: 1000 }, quantity: "100", period: "yearly" }, estimateCost);
      expect(result.period).toBe("yearly");
      expect(result.quantity).toBe(100);
    });

    it("should reject missing metrics", () => {
      expect(errorsOf({ quantity: 100 }, estimateCost)).toEqual([
        { field: "metrics", message: "Invalid input: expected record, received undefined" },
      ]);
    });

    it("should reject metrics that are not an object", () => {
      expect(errorsOf({ metrics: [1], quantity: 1 }, estimateCost)).toEqual([
        { field: "metrics", message: "Invalid input: expected record, received array" },
      ]);
    });

    it("should reject missing quantity", () => {
      expect(errorsOf({ metrics: { api_calls: 1000 } }, estimateCost)).toEqual([
        { field: "quantity", message: "Invalid input: expected number, received undefined" },
      ]);
    });

    it("should reject non-positive quantity", () => {
      expect(errorsOf({ metrics: { api_calls: 1000 }, quantity: 0 }, estimateCost)).toEqual([
        { field: "quantity", message: "Too small: expected number to be >0" },
      ]);
    });

    it("should reject a fractional quantity", () => {
      expect(errorsOf({ metrics: { api_calls: 1000 }, quantity: 1.5 }, estimateCost)).toEqual([
        { field: "quantity", message: "Invalid input: expected int, received number" },
      ]);
    });

    it("should reject invalid period", () => {
      expect(errorsOf({ metrics: { api_calls: 1000 }, quantity: 100, period: "invalid" }, estimateCost)).toEqual([
        { field: "period", message: 'Invalid option: expected one of "hourly"|"daily"|"monthly"|"yearly"' },
      ]);
    });
  });

  describe("getAnalytics", () => {
    it("should validate correct analytics query", () => {
      expect(validate({ period: "30d" }, getAnalytics)).toEqual({ period: "30d" });
    });

    it("should accept optional metrics array", () => {
      const result = validate({ period: "90d", metrics: ["api_calls", "storage"] }, getAnalytics);
      expect(result.metrics).toEqual(["api_calls", "storage"]);
    });

    it("should accept all valid periods", () => {
      for (const period of ["7d", "30d", "90d", "1y"]) {
        expect(validate({ period }, getAnalytics).period).toBe(period);
      }
    });

    it("should default to 30d period", () => {
      expect(validate({}, getAnalytics).period).toBe("30d");
    });

    it("should reject invalid period", () => {
      expect(errorsOf({ period: "invalid" }, getAnalytics)).toEqual([
        { field: "period", message: 'Invalid option: expected one of "7d"|"30d"|"90d"|"1y"' },
      ]);
    });

    it("should reject a single metric string (an array is required)", () => {
      expect(errorsOf({ metrics: "api_calls" }, getAnalytics)).toEqual([
        { field: "metrics", message: "Invalid input: expected array, received string" },
      ]);
    });
  });

  describe("getBillingHistory", () => {
    it("should validate correct billing history query", () => {
      expect(validate({ page: 1, limit: 20 }, getBillingHistory)).toEqual({ page: 1, limit: 20 });
    });

    it("should accept optional date range, from query strings", () => {
      const result = validate(
        { page: "1", limit: "50", startDate: "2024-01-01", endDate: "2024-12-31" },
        getBillingHistory,
      );
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.startDate.toISOString().slice(0, 10)).toBe("2024-01-01");
      expect(result.endDate.toISOString().slice(0, 10)).toBe("2024-12-31");
    });

    it("should accept a startDate alone, and an endDate equal to the startDate", () => {
      expect(validate({ startDate: "2024-01-01" }, getBillingHistory).startDate).toEqual(new Date("2024-01-01"));
      expect(() => validate({ startDate: "2024-01-01", endDate: "2024-01-01" }, getBillingHistory)).not.toThrow();
    });

    it("should accept millisecond timestamps", () => {
      const result = validate({ startDate: "1704067200000", endDate: 1735603200000 }, getBillingHistory);
      expect(result.startDate).toEqual(new Date(1704067200000));
      expect(result.endDate).toEqual(new Date(1735603200000));
    });

    it("should default page to 1", () => {
      expect(validate({}, getBillingHistory).page).toBe(1);
    });

    it("should default limit to 20", () => {
      expect(validate({}, getBillingHistory).limit).toBe(20);
    });

    it("should reject page less than 1", () => {
      expect(errorsOf({ page: 0 }, getBillingHistory)).toEqual([
        { field: "page", message: "Too small: expected number to be >=1" },
      ]);
    });

    it("should reject limit greater than 100", () => {
      expect(errorsOf({ limit: 101 }, getBillingHistory)).toEqual([
        { field: "limit", message: "Too big: expected number to be <=100" },
      ]);
    });

    it("should reject endDate before startDate", () => {
      expect(errorsOf({ startDate: "2024-12-31", endDate: "2024-01-01" }, getBillingHistory)).toEqual([
        { field: "endDate", message: "endDate must be after startDate" },
      ]);
    });

    it("should reject an endDate without a startDate (as the old reference rule did)", () => {
      expect(errorsOf({ endDate: "2024-01-01" }, getBillingHistory)).toEqual([
        { field: "endDate", message: "endDate must be after startDate" },
      ]);
    });

    it("should reject an unparseable date", () => {
      expect(errorsOf({ startDate: "garbage" }, getBillingHistory)).toEqual([
        { field: "startDate", message: "Invalid input: expected date, received string" },
      ]);
    });
  });

  describe("validateInput with these schemas", () => {
    it("should return validated data for valid input", () => {
      expect(validate({ metricName: "api_calls", threshold: 100 }, createUsageAlert).metricName).toBe("api_calls");
    });

    it("should throw the 400 failure for invalid input, listing every field", () => {
      let thrown;
      try {
        validate({ invalid: "data" }, createUsageAlert);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [
          { field: "metricName", message: "Invalid input: expected string, received undefined" },
          { field: "threshold", message: "Invalid input: expected number, received undefined" },
        ],
      });
    });
  });

  describe("validate(schema) body middleware", () => {
    it("should call next() for valid body", () => {
      const mockReq = { body: { metricName: "api_calls", threshold: 100 } };
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockResponse(), next);

      expect(next).toHaveBeenCalledWith();
      expect(mockReq.body.metricName).toBe("api_calls");
    });

    it("should answer 400 for invalid body, without calling next()", () => {
      const mockReq = { body: { invalid: "data" } };
      const res = mockResponse();
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, status: 400, message: "Validation Error" }));
    });

    it("should handle empty body object", () => {
      const res = mockResponse();
      const next = jest.fn();

      validateBody(createUsageAlert)({ body: {} }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should apply default values for missing optional fields", () => {
      const mockReq = { body: { metricName: "api_calls", threshold: 100 } };
      const next = jest.fn();

      validateBody(createUsageAlert)(mockReq, mockResponse(), next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.body.notificationChannels).toEqual(["email"]);
      expect(mockReq.body.isEnabled).toBe(true);
      expect(mockReq.body.comparison).toBe("gte");
    });

    it("should use empty object when req.body is undefined", () => {
      const res = mockResponse();
      const next = jest.fn();

      validateBody(createUsageAlert)({}, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("validate(schema, { from: 'query' }) middleware", () => {
    it("should call next() for valid query, the parsed value on req.validated", () => {
      const mockReq = { query: { period: "30d" } };
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockResponse(), next);

      expect(next).toHaveBeenCalledWith();
      expect(mockReq.validated).toEqual({ period: "30d" });
    });

    it("should answer 400 for invalid query", () => {
      const res = mockResponse();
      const next = jest.fn();

      validateQuery(getAnalytics)({ query: { period: "invalid" } }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should handle empty query object, applying the default", () => {
      const mockReq = { query: {} };
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockResponse(), next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.validated).toEqual({ period: "30d" });
    });

    it("should not modify req.query (read-only)", () => {
      const mockReq = { query: { period: "7d", page: "2" } };
      const originalQuery = { ...mockReq.query };
      const next = jest.fn();

      validateQuery(getBillingHistory)(mockReq, mockResponse(), next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.query).toEqual(originalQuery);
      expect(mockReq.validated).toEqual({ page: 2, limit: 20 });
    });

    it("should use empty object when req.query is undefined", () => {
      const mockReq = {};
      const next = jest.fn();

      validateQuery(getAnalytics)(mockReq, mockResponse(), next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.validated).toEqual({ period: "30d" });
    });
  });
});
