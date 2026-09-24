const { logger } = require("./activityLog.middleware");
const { sanitizeError } = require("../utils/fileValidation.util");

/**
 * Global Error Handler Middleware
 * Logs errors with Winston and returns standardized JSON responses
 * Automatically sanitizes errors in production mode: an operational 4xx keeps
 * its message, anything else gets the generic one and the request id (A-132,
 * fileValidation.util#isExposableError — the rule asyncHandler applies too).
 */
exports.errorHandler = (err, req, res, next) => {
  // statusCode too, as sanitizeError and the controller wrappers read it, so
  // the HTTP status and the body's `status` cannot disagree.
  const statusCode = err.status || err.statusCode || 500;
  const requestId = req.requestId || "unknown";
  const isProduction = process.env.NODE_ENV === "production";

  // Structured logging with Winston (always log full details)
  logger.error(err.message || "Internal server error", {
    requestId,
    statusCode,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    stack: err.stack,
  });

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
