/**
 * Tests for appError utility
 */

const {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  LockedError,
  InternalServerError,
  formatErrors,
} = require("../../utils/appError.util");

describe("AppError", () => {
  it("should create an AppError with status and message", () => {
    const err = new AppError(400, "Bad request");

    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Bad request");
    expect(err.isOperational).toBe(true);
  });

  it("should default to 500 status", () => {
    const err = new AppError();

    expect(err.status).toBe(500);
  });

  it("should handle various HTTP status codes", () => {
    const codes = [400, 401, 403, 404, 409, 422, 429, 500, 503];

    for (const code of codes) {
      const err = new AppError(code, "Error message");
      expect(err.status).toBe(code);
    }
  });

  it("should set isOperational to false for non-operational errors", () => {
    const err = new AppError(500, "Error", false);
    expect(err.isOperational).toBe(false);
  });

  it("should store details", () => {
    const details = { code: "E001" };
    const err = new AppError(400, "Bad request", true, details);
    expect(err.details).toEqual(details);
  });

  it("should have proper stack trace", () => {
    const err = new AppError(400, "Test error");
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("Test error");
  });

  it("should be instance of Error", () => {
    const err = new AppError(400, "Test");
    expect(err).toBeInstanceOf(Error);
  });

  describe("toJSON", () => {
    it("should return JSON response object", () => {
      const err = new AppError(400, "Bad request");
      const json = err.toJSON();

      expect(json).toEqual({
        success: false,
        status: 400,
        message: "Bad request",
      });
    });

    it("should include details in non-production", () => {
      process.env.NODE_ENV = "development";
      const err = new AppError(400, "Bad request", true, { field: "email" });
      const json = err.toJSON();

      expect(json.details).toEqual({ field: "email" });
      process.env.NODE_ENV = "test";
    });

    it("should not include details in production", () => {
      process.env.NODE_ENV = "production";
      const err = new AppError(400, "Bad request", true, { field: "email" });
      const json = err.toJSON();

      expect(json.details).toBeUndefined();
      process.env.NODE_ENV = "test";
    });
  });
});

describe("Specific error classes", () => {
  it("BadRequestError should have status 400", () => {
    const err = new BadRequestError("Invalid input");
    expect(err.status).toBe(400);
    expect(err.isOperational).toBe(true);
  });

  it("UnauthorizedError should have status 401", () => {
    const err = new UnauthorizedError();
    expect(err.status).toBe(401);
  });

  it("ForbiddenError should have status 403", () => {
    const err = new ForbiddenError("Access denied");
    expect(err.status).toBe(403);
  });

  it("NotFoundError should have status 404", () => {
    const err = new NotFoundError();
    expect(err.status).toBe(404);
  });

  it("ConflictError should have status 409", () => {
    const err = new ConflictError("Duplicate entry");
    expect(err.status).toBe(409);
  });

  it("TooManyRequestsError should have status 429", () => {
    const err = new TooManyRequestsError();
    expect(err.status).toBe(429);
  });

  it("LockedError should have status 423", () => {
    const err = new LockedError();
    expect(err.status).toBe(423);
  });

  it("InternalServerError should have status 500 and not be operational", () => {
    const err = new InternalServerError();
    expect(err.status).toBe(500);
    expect(err.isOperational).toBe(false);
  });

  it("InternalServerError should accept details", () => {
    const err = new InternalServerError("DB error", {
      db: "connection failed",
    });
    expect(err.status).toBe(500);
    expect(err.details).toEqual({ db: "connection failed" });
  });

  it("should use default message and details for BadRequestError, ForbiddenError, and ConflictError", () => {
    const badReq = new BadRequestError();
    expect(badReq.message).toBe("Bad request");
    expect(badReq.details).toBeNull();

    const forbidden = new ForbiddenError();
    expect(forbidden.message).toBe("Forbidden");

    const conflict = new ConflictError();
    expect(conflict.message).toBe("Conflict");
  });
});

describe("formatErrors", () => {
  it("should format a single error", () => {
    const details = [
      {
        message: "Email is required",
        path: ["email"],
        type: "any.required",
      },
    ];

    const result = formatErrors(details);

    expect(result).toBe("Email is required");
  });

  it("should format multiple errors", () => {
    const details = [
      { message: "Email is required", path: ["email"], type: "any.required" },
      {
        message: "Password is too short",
        path: ["password"],
        type: "string.min",
      },
    ];

    const result = formatErrors(details);

    expect(result).toContain("Email is required");
    expect(result).toContain("Password is too short");
  });

  it("should handle empty array", () => {
    const result = formatErrors([]);

    expect(result).toBe("");
  });

  it("should handle null input", () => {
    const result = formatErrors(null);

    expect(result).toBe("");
  });

  it("should handle undefined input", () => {
    const result = formatErrors(undefined);

    expect(result).toBe("");
  });
});
