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

// P9-09 (ADR-087 Amendment 5): converted from controllerWrapper.util.js with
// no behaviour change. The .js destructured its three helpers at load, so a
// later replacement of `response.util.error` or the fileValidation helpers did
// not reach it; the consts below capture them at load the same way. The .js
// also required appError.util without using it; the bare import keeps that
// module load where it was.
import type { NextFunction, Request, Response } from "express";
import { error as responseError } from "./response.util";
import "./appError.util";
import { isProduction } from "../config/env";
import {
  isExposableError as fileValidationIsExposableError,
  publicErrorMessage as fileValidationPublicErrorMessage,
} from "./fileValidation.util";

const sendError = responseError;
const isExposableError = fileValidationIsExposableError;
const publicErrorMessage = fileValidationPublicErrorMessage;

/** What the wrappers read of a thrown error (JavaScript throws many shapes). */
interface ThrownError {
  status?: number;
  statusCode?: number;
  message?: string;
  stack?: string;
  retryAfterSeconds?: unknown;
  errors?: unknown;
  publicCode?: unknown;
  publicFields?: unknown;
  [key: string]: unknown;
}

/**
 * A-272 (ADR-100) — `validators/input#validateInput` throws a plain
 * `{ status: 400, message: "Validation failed", errors: [{ field, message }] }`.
 * It used to reach the wire as "Validation failed" with the STACK argument
 * `String(error)` — "[object Object]" — as `details`, and its field list
 * dropped. It is now answered exactly as the `validate()` middleware answers:
 * 400, "Validation Error", and `details: [{ field, message }]` outside
 * production (response.util#error), so a client reads one shape whichever
 * layer rejected the input.
 */
const isValidationFailure = (error: ThrownError | null | undefined): error is ThrownError & { errors: unknown[] } =>
  !!error && error.status === 400 && error.message === "Validation failed" && Array.isArray(error.errors);

/**
 * ADR-100 — a machine-readable reason a client may act on (e.g. the sign-in
 * page's `LOCATION_REQUIRED`, services/signInPolicy.service.ts). Sent as a
 * top-level `code` in every environment; only an UPPER_SNAKE token is sent.
 */
const publicCodeOf = (error: ThrownError | null | undefined): string | null =>
  error && typeof error.publicCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.publicCode)
    ? error.publicCode
    : null;

/**
 * P21-03 — the extra top-level fields a coded error carries (utils/codedError.util): string values
 * under camelCase keys only, and never `success`, `status`, `message`, `data` or `code`.
 */
const publicFieldsOf = (error: ThrownError | null | undefined): Record<string, string> => {
  const fields = error?.publicFields;
  if (!fields || typeof fields !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === "string" && /^[a-z][A-Za-z0-9]{0,63}$/.test(key) && !["success", "status", "message", "data", "code"].includes(key)) {
      out[key] = value;
    }
  }
  return out;
};

/** A controller function, as the wrappers call it. */
type Controller = (req: Request, res: Response, next: NextFunction) => unknown;

/** An Express handler, as the wrappers return it. */
type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | undefined;

const isProductionEnv = (): boolean => isProduction();

/**
 * Send a caught controller error (A-132) under the same rule as the global
 * errorHandler: in production the error's own message goes out only when it is
 * an operational 4xx (fileValidation.util#isExposableError, or `exposable`
 * when a caller has classified it); otherwise the generic message and the
 * request id.
 *
 * @param req - the request (may be absent)
 * @param res - the response
 * @param error - whatever was thrown
 * @param status - the status to answer with
 * @param detailsArg - `[details]` for response.util#error, or `[]`
 * @param exposable - the caller's own classification
 */
const sendCaughtError = (
  req: Request | undefined,
  res: Response,
  error: ThrownError | null | undefined,
  status: number,
  detailsArg: [unknown?],
  exposable?: boolean,
): Response => {
  if (isValidationFailure(error)) {
    return sendError(res, "Validation Error", 400, error.errors);
  }
  const isProduction = isProductionEnv();
  // A-260: a 429 that knows when the pause ends says so (RFC 9110 §10.2.3).
  if (status === 429 && error && Number.isFinite(error.retryAfterSeconds)) {
    // Number.isFinite above: a finite number.
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds as number))));
  }
  const shown = exposable === true || isExposableError(error, status);
  const message = shown
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain -- as built
    ? (error && error.message) || "Internal server error"
    : publicErrorMessage(error, status, isProduction);

  if (isProduction && !shown) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain -- as built
    const requestId = (req && req.requestId) || "unknown";
    return sendError(res, message, status, null, { requestId });
  }
  const code = publicCodeOf(error);
  if (code) {
    return sendError(res, message, status, detailsArg[0] ?? null, { ...publicFieldsOf(error), code });
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
// is wrapped — health.controller.ts (public probes, no API-key path) and
// predictiveMaintenance.controller.ts (every route carries dynamicAccess, so a
// key is authorized by scope) — and a key that arrives without a gate having
// authorized it is refused. V-05: the unwrapped list is enumerated by
// tests/guards/apiKeyAuthorizedWriters.v05.guard.test.ts, not by this prose.
//
// Exactly two gates authorize a key (they set `req.apiKeyAuthorized`):
// dynamicAccess's scope check and the SCIM gate (scim.route.js). The same
// guard fails on a third writer.
const apiKeyBlocked = (req: Request | undefined, res: Response): boolean => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!req || !req.user || !req.user.isApiKey || req.apiKeyAuthorized) {
    return false;
  }
  sendError(res, "This API key is not authorized for this endpoint", 403);
  return true;
};

/**
 * Wraps an async controller function to handle errors centrally
 * @param fn - Async controller function
 * @returns Express middleware function
 */
const asyncHandler = (fn: Controller): Handler => {
  return (req, res, next) => {
    if (apiKeyBlocked(req, res)) {
      return undefined;
    }
    return Promise.resolve(fn(req, res, next)).catch((caught: unknown) => {
      // As built: read as an object; a thrown null or undefined throws here, as it did.
      const error = caught as ThrownError;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls through
      const status = error.status || error.statusCode || 500;

      // Call response utility error handler
      try {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built
        sendCaughtError(req, res, error, status, [error.stack || String(error)]);
      } catch {
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
 * @param error - the thrown error
 * @param errorMap - message pattern -> status
 * @returns the mapped status, or null
 */
const mappedErrorStatus = (error: ThrownError, errorMap: Record<string, number>): number | null => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" falls back
  const errorMessage = error.message || "Internal server error";
  for (const [pattern, code] of Object.entries(errorMap)) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return code;
    }
  }
  return null;
};

const resolveErrorStatus = (error: ThrownError, errorMap: Record<string, number>): number =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls through
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
const asyncHandlerWithMapping = (fn: Controller, errorMap: Record<string, number> = {}): Handler => {
  return (req, res, next) => {
    if (apiKeyBlocked(req, res)) {
      return undefined;
    }
    return Promise.resolve(fn(req, res, next))
      .then((result: unknown) => {
        // Only the error path used to be handled here. Controllers that
        // returned an envelope instead of sending it (admin, qms, sop,
        // batchJob — 16 routes) therefore never produced a response and hung
        // until the 30s timeout middleware returned 503.
        if (res.headersSent || !result || typeof result !== "object") {
          return;
        }
        const { status: resultStatus } = result as { status?: unknown };
        const status = typeof resultStatus === "number" ? resultStatus : 200;
        return res.status(status).json(result);
      })
      .catch((caught: unknown) => {
        // As built: read as an object; a thrown null or undefined throws here, as it did.
        const error = caught as ThrownError;
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

export {
  asyncHandler,
  asyncHandlerWithMapping,
  resolveErrorStatus,
};
