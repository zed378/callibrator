const { logger } = require("./activityLog.middleware");
const { sanitizeError } = require("../utils/fileValidation.util");

/**
 * Global Error Handler Middleware
 * Logs errors with Winston and returns standardized JSON responses
 * Automatically sanitizes errors in production mode
 */
exports.errorHandler = (err, req, res, next) => {
  const statusCode = err.status || 500;
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

  // Build sanitized response
  const sanitized = sanitizeError(err, isProduction);
  const response = {
    ...sanitized,
    requestId,
  };

  return res.status(statusCode).json(response);
};
