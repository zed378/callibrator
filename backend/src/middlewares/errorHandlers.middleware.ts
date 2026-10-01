// P9-19 (ADR-087): converted from errorHandlers.middleware.js with no
// behaviour change. The logger and sanitizeError are captured at load, as the
// .js destructured them; NODE_ENV is read per call through src/config/env.
import type { NextFunction, Request, Response } from "express";
import { logger as activityLogger } from "./activityLog.middleware";
import { sanitizeError as fileValidationSanitizeError } from "../utils/fileValidation.util";
import { isProduction as isProductionEnv } from "../config/env";

const logger = activityLogger;
const sanitizeError = fileValidationSanitizeError;

/** What this handler reads from an error; anything may be thrown, so each member is optional. */
interface HandledError {
  status?: number;
  statusCode?: number;
  message?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Global Error Handler Middleware
 * Logs errors with Winston and returns standardized JSON responses
 * Automatically sanitizes errors in production mode: an operational 4xx keeps
 * its message, anything else gets the generic one and the request id (A-132,
 * fileValidation.util#isExposableError — the rule asyncHandler applies too).
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status, an empty message or request id falls through */
export const errorHandler = (
  err: HandledError,
  req: Request,
  res: Response,
  // Express recognises an error handler by its four parameters, so `next`
  // is declared although it is never called.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the four-argument signature is what makes this an error handler
  _next: NextFunction,
): Response | undefined => {
  // statusCode too, as sanitizeError and the controller wrappers read it, so
  // the HTTP status and the body's `status` cannot disagree.
  const statusCode = err.status || err.statusCode || 500;
  const requestId = req.requestId || "unknown";
  const isProduction = isProductionEnv();

  // Structured logging with Winston (always log full details)
  logger.error(err.message || "Internal server error", {
    requestId,
    statusCode,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    stack: err.stack,
  });
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  // asyncHandler has already answered the request and forwards the error here
  // only so it is logged against the request id. Writing a second response
  // would throw ERR_HTTP_HEADERS_SENT inside this handler.
  if (res.headersSent) {
    return undefined;
  }

  // Build sanitized response
  const sanitized = sanitizeError(err, isProduction);
  const response = {
    ...sanitized,
    requestId,
  };

  return res.status(statusCode).json(response);
};
