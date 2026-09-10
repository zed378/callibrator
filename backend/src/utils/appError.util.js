/**
 * Custom Error Classes
 * Provides structured error types with status codes for consistent error handling
 */

/**
 * Base application error class
 * Extends native Error with HTTP status code and operational flag
 */
class AppError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} message - Error message
   * @param {boolean} isOperational - Whether this is an expected operational error
   * @param {object|null} details - Optional error details
   */
  constructor(status = 500, message = "Internal Server Error", isOperational = true, details = null) {
    super(message);
    this.status = status;
    this.isOperational = isOperational;
    this.details = details;

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    const response = {
      success: false,
      status: this.status,
      message: this.message,
    };

    if (process.env.NODE_ENV !== "production" && this.details) {
      response.details = this.details;
    }

    return response;
  }
}

/**
 * Bad Request Error (400)
 */
class BadRequestError extends AppError {
  constructor(message = "Bad request", details = null) {
    super(400, message, true, details);
  }
}

/**
 * Unauthorized Error (401)
 */
class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, true);
  }
}

/**
 * Forbidden Error (403)
 */
class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, true);
  }
}

/**
 * Not Found Error (404)
 */
class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message, true);
  }
}

/**
 * Conflict Error (409)
 */
class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, message, true);
  }
}

/**
 * Too Many Requests Error (429)
 */
class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") {
    super(429, message, true);
  }
}

/**
 * Locked Error (423)
 */
class LockedError extends AppError {
  constructor(message = "Account locked") {
    super(423, message, true);
  }
}

/**
 * Internal Server Error (500)
 */
class InternalServerError extends AppError {
  constructor(message = "Internal server error", details = null) {
    super(500, message, false, details);
  }
}

const formatErrors = (details) => {
  if (!details || !Array.isArray(details) || details.length === 0) {
    return "";
  }
  return details.map((item) => item.message).join(", ");
};

module.exports = {
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
};
