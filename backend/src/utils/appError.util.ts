/**
 * Custom Error Classes
 * Provides structured error types with status codes for consistent error handling
 *
 * P9-09 (ADR-087): converted from appError.util.js with no behaviour change.
 * The hierarchy is typed here; `details` stays `unknown` because callers pass
 * Joi detail arrays, objects and strings alike.
 */

import { isProduction } from "../config/env";

/** The body `AppError#toJSON()` produces. Module-local (agreed with the P9 lead). */
export interface AppErrorBody {
  success: false;
  status: number;
  message: string;
  details?: unknown;
}

/**
 * Base application error class
 * Extends native Error with HTTP status code and operational flag
 */
class AppError extends Error {
  declare status: number;
  declare isOperational: boolean;
  declare details: unknown;

  /**
   * @param status - HTTP status code
   * @param message - Error message
   * @param isOperational - Whether this is an expected operational error
   * @param details - Optional error details
   */
  constructor(status = 500, message = "Internal Server Error", isOperational = true, details: unknown = null) {
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
  toJSON(): AppErrorBody {
    const response: AppErrorBody = {
      success: false,
      status: this.status,
      message: this.message,
    };

    if (!isProduction() && this.details) {
      response.details = this.details;
    }

    return response;
  }
}

/**
 * Bad Request Error (400)
 */
class BadRequestError extends AppError {
  constructor(message = "Bad request", details: unknown = null) {
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
  constructor(message = "Internal server error", details: unknown = null) {
    super(500, message, false, details);
  }
}

/** A validation detail as Joi reports it; only `message` is read. */
interface MessageDetail {
  message: unknown;
}

/**
 * Join the `message` of each detail with ", ". Anything that is not a
 * non-empty array gives "", as before.
 */
const formatErrors = (details: unknown): string => {
  if (!details || !Array.isArray(details) || details.length === 0) {
    return "";
  }
  return (details as readonly MessageDetail[]).map((item) => item.message).join(", ");
};

export {
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
