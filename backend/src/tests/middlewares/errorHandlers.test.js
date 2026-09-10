/**
 * Tests for errorHandlers middleware
 * Tests the global error handler with structured logging, sanitization,
 * and standardized JSON responses in production and development modes.
 */
jest.mock("../../utils/fileValidation.util", () => ({
  sanitizeError: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn() },
}));

const { logger } = require("../../middlewares/activityLog.middleware");
const { sanitizeError } = require("../../utils/fileValidation.util");
const { errorHandler } = require("../../middlewares/errorHandlers.middleware");
const { createMockReq } = require("../utils/test.utils");

describe("errorHandler middleware", () => {
  let req, res, next;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    req = createMockReq();
    req.requestId = "req-123";
    req.method = "POST";
    req.originalUrl = "/api/users";
    req.ip = "127.0.0.1";
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("should log error with Winston and return sanitized response", () => {
    process.env.NODE_ENV = "development";
    const err = new Error("Something broke");
    err.status = 500;
    err.stack = "Error: Something broke\n    at handler";

    sanitizeError.mockReturnValue({ success: false, message: "Something broke" });

    errorHandler(err, req, res, next);

    expect(logger.error).toHaveBeenCalledWith("Something broke", expect.objectContaining({
      requestId: "req-123",
      statusCode: 500,
      method: "POST",
      url: "/api/users",
      ip: "127.0.0.1",
      stack: "Error: Something broke\n    at handler",
    }));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
    const calledWith = res.json.mock.calls[0][0];
    expect(calledWith.message).toBe("Something broke");
    expect(calledWith.requestId).toBe("req-123");
  });

  it("should sanitize error messages in production mode", () => {
    process.env.NODE_ENV = "production";
    const err = new Error("DB connection failed to host db.internal:5432");
    err.status = 500;
    err.stack = "Error: DB connection failed";

    sanitizeError.mockReturnValue({
      success: false,
      message: "An unexpected error occurred. Please try again later.",
    });

    errorHandler(err, req, res, next);

    expect(sanitizeError).toHaveBeenCalledWith(err, true);
    const calledWith = res.json.mock.calls[0][0];
    expect(calledWith.message).toBe("An unexpected error occurred. Please try again later.");
    expect(calledWith.requestId).toBe("req-123");
  });

  it("should use default status 500 when err.status is missing", () => {
    process.env.NODE_ENV = "development";
    const err = new Error("no status field");
    delete err.status;

    sanitizeError.mockReturnValue({ success: false, message: "no status field" });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("should use the error's status code when provided", () => {
    process.env.NODE_ENV = "development";
    const err = new Error("bad request");
    err.status = 400;

    sanitizeError.mockReturnValue({ success: false, message: "bad request" });

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should handle error with no message", () => {
    process.env.NODE_ENV = "development";
    const err = new Error();
    err.status = 500;

    sanitizeError.mockReturnValue({ success: false, message: "Internal server error" });

    errorHandler(err, req, res, next);

    expect(logger.error).toHaveBeenCalledWith("Internal server error", expect.any(Object));
  });

  it("should include requestId 'unknown' when req.requestId is missing", () => {
    process.env.NODE_ENV = "development";
    delete req.requestId;
    const err = new Error("test");
    err.status = 500;

    sanitizeError.mockReturnValue({ success: false, message: "test" });

    errorHandler(err, req, res, next);

    expect(res.json.mock.calls[0][0].requestId).toBe("unknown");
  });
});
