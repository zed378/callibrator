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
const {
  isExposableError,
  publicErrorMessage,
} = require("./fileValidation.util");

const isProductionEnv = () => process.env.NODE_ENV === "production";

/**
 * Send a caught controller error (A-132) under the same rule as the global
 * errorHandler: in production the error's own message goes out only when it is
 * an operational 4xx (fileValidation.util#isExposableError, or `exposable`
 * when a caller has classified it); otherwise the generic message and the
 * request id.
 *
 * @param {import('express').Request|undefined} req
 * @param {import('express').Response} res
 * @param {*} error
 * @param {number} status
 * @param {Array} detailsArg - `[details]` for response.util#error, or `[]`
 * @param {boolean} [exposable] - the caller's own classification
 */
const sendCaughtError = (req, res, error, status, detailsArg, exposable) => {
  const isProduction = isProductionEnv();
  // A-260: a 429 that knows when the pause ends says so (RFC 9110 §10.2.3).
  if (status === 429 && error && Number.isFinite(error.retryAfterSeconds)) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
  }
  const shown = exposable === true || isExposableError(error, status);
  const message = shown
    ? (error && error.message) || "Internal server error"
    : publicErrorMessage(error, status, isProduction);

  if (isProduction && !shown) {
    const requestId = (req && req.requestId) || "unknown";
    return sendError(res, message, status, null, { requestId });
  }
  return sendError(res, message, status, ...detailsArg);
};

// A-03. Deny-by-default for API-key principals.
//
// Only `dynamicAccess` reads an API key's scopes. On a route gated some other
// way — or gated by `auth` alone — the key used to pass as an ordinary
// authenticated principal, so a key scoped to `warehouse:read` could reach any
// such handler. There is no Express hook that runs after the middleware chain
// but before the controller, so the check lives here: every controller but two
// is wrapped, and a key that arrives without a gate having authorized it is
// refused.
//
// A route that is deliberately open to service accounts opts in with
// `allowApiKey` from auth.middleware.
const apiKeyBlocked = (req, res) => {
  if (!req || !req.user || !req.user.isApiKey || req.apiKeyAuthorized) {
    return false;
  }
  sendError(res, "This API key is not authorized for this endpoint", 403);
  return true;
};

/**
 * Wraps an async controller function to handle errors centrally
 * @param {Function} fn - Async controller function
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    if (apiKeyBlocked(req, res)) {
      return undefined;
    }
    return Promise.resolve(fn(req, res, next)).catch((error) => {
      const status = error.status || error.statusCode || 500;

      // Call response utility error handler
      try {
        sendCaughtError(req, res, error, status, [error.stack || String(error)]);
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
 * The status asyncHandlerWithMapping answers an error with: the error's own
 * status, overridden by the first `errorMap` pattern its message contains
 * (case-insensitive), 500 when neither says anything.
 *
 * Exported so a handler that must act on the outcome BEFORE the response is
 * sent (auth.controller records rate-limit failures, A-67) resolves the status
 * exactly as the wrapper will, from the same map.
 *
 * @param {Error & {status?: number, statusCode?: number}} error
 * @param {Record<string, number>} errorMap
 * @returns {number}
 */
const mappedErrorStatus = (error, errorMap) => {
  const errorMessage = error.message || "Internal server error";
  for (const [pattern, code] of Object.entries(errorMap)) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return code;
    }
  }
  return null;
};

const resolveErrorStatus = (error, errorMap) =>
  mappedErrorStatus(error, errorMap) ?? (error.status || error.statusCode || 500);

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
    if (apiKeyBlocked(req, res)) {
      return undefined;
    }
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
        const statusCode = resolveErrorStatus(error, errorMap);
        // A status the controller's errorMap assigned is its author's own
        // classification of that message as a client error (A-132).
        const mapped = mappedErrorStatus(error, errorMap);
        return sendCaughtError(
          req,
          res,
          error,
          statusCode,
          [],
          mapped !== null && mapped >= 400 && mapped < 500,
        );
      });
  };
};

module.exports = {
  asyncHandler,
  asyncHandlerWithMapping,
  resolveErrorStatus,
};
