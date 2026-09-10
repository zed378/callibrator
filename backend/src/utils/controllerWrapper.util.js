/**
 * Controller Wrapper Utility
 * Eliminates repetitive try/catch blocks in controllers
 *
 * Usage:
 *   const { asyncHandler } = require("../utils/controllerWrapper.util");
 *
 *   exports.getAllUsers = asyncHandler(async (req, res) => {
 *     const result = await userService.fetchUsers(req.query);
 *     res.success(result);
 *   });
 */

const { error: sendError } = require("./response.util");
const { AppError } = require("./appError.util");

/**
 * Wraps an async controller function to handle errors centrally
 * @param {Function} fn - Async controller function
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch((error) => {
      // Ensure status and message are resolved
      const status = error.status || error.statusCode || 500;
      const message = error.message || "Internal server error";

      // Call response utility error handler
      try {
        sendError(res, message, status, error.stack || String(error));
      } catch (err) {
        // Ignore response errors
      }

      // Forward to Express next handler if provided
      if (typeof next === "function") {
        // Ensure status is set on error
        error.status = status;
        next(error);
      }
    });
  };
};

/**
 * Wraps a controller with custom error mapping
 * Use this when service errors use string matching instead of status codes
 *
 * The wrapped handler may either send the response itself (e.g. via
 * `success(res, ...)`) or simply RETURN a `{ success, status, message, data }`
 * envelope — both styles are used across the codebase and both work.
 *
 * Usage:
 *   exports.getAllUsers = asyncHandlerWithMapping(async (req, res) => { ... }, {
 *     credentials: 401,
 *     verify: 403,
 *     suspended: 403,
 *     locked: 423,
 *   });
 */
const asyncHandlerWithMapping = (fn, errorMap = {}) => {
  return (req, res, next) => {
    return Promise.resolve(fn(req, res, next))
      .then((result) => {
        // Only the error path used to be handled here. Controllers that
        // returned an envelope instead of sending it (admin, qms, sop,
        // batchJob — 16 routes) therefore never produced a response and hung
        // until the 30s timeout middleware returned 503.
        if (res.headersSent || !result || typeof result !== "object") {
          return;
        }
        const status = typeof result.status === "number" ? result.status : 200;
        return res.status(status).json(result);
      })
      .catch((error) => {
        let statusCode = error.status || error.statusCode || 500;
        const errorMessage = error.message || "Internal server error";

        // Map error message patterns to status codes
        for (const [pattern, code] of Object.entries(errorMap)) {
          if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
            statusCode = code;
            break;
          }
        }

        const { error: sendError } = require("./response.util");
        return sendError(res, errorMessage, statusCode);
      });
  };
};

module.exports = {
  asyncHandler,
  asyncHandlerWithMapping,
};
