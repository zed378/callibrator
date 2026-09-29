/**
 * Standardized API Response Helper
 * Ensures consistent response format across all endpoints
 *
 * Standard Response Format:
 * {
 *   success: boolean,      // true for success, false for error
 *   message: string,       // descriptive message
 *   data: any,             // the actual requested data (null for errors)
 *   meta: {                // metadata with counts (optional)
 *     total: number,       // total count of items
 *     page: number,        // current page number
 *     limit: number,       // items per page
 *     totalPages: number,  // total number of pages
 *     customCounts: {}     // optional custom counts (e.g., active, inactive)
 *   },
 *   token: string,         // only for login/auth responses
 *   session: {             // only for login/auth responses
 *     id: string,
 *     createdAt: string,
 *     expiresAt: string
 *   }
 * }
 *
 * P9-09 (ADR-087 Amendment 5): converted from response.util.js with no
 * behaviour change. The envelope types are `types/apiResponse.ts`; every body
 * is built in the same key order as before (the JSON a client reads is byte
 * for byte what it was). Parameters are typed as the JavaScript callers pass
 * them; the runtime `typeof` checks the .js made are all still made.
 */
import type { Response } from "express";
import type { ApiErrorResponse, ApiSuccessResponse } from "../types/apiResponse";
import { isProduction } from "../config/env";

/** Token and session for a sign-in answer. */
interface AuthData {
  token?: unknown;
  refreshToken?: unknown;
  session?: unknown;
}

/** A service result envelope, as `sendResult` reads it. */
interface ServiceResult {
  success?: boolean;
  status?: unknown;
  message?: string;
  data?: unknown;
}

/**
 * Send a success response
 * @param {import('express').Response} res - Express response object
 * @param {*} data - Response data (the actual information requested)
 * @param {Object} meta - Metadata object with counts (optional)
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {Object} authData - Token and session data for login responses (optional)
 */
const success = (
  res: Response,
  data: unknown = null,
  metaOrMessage: object | string | null = null,
  messageOrStatusCode: string | number | null = null,
  statusCode = 200,
  authData: AuthData | null = null,
): Response => {
  let meta: object | null = null;
  let message = "success";
  let status = 200;

  if (typeof metaOrMessage === "string") {
    message = metaOrMessage;
    if (typeof messageOrStatusCode === "number") {
      status = messageOrStatusCode;
    } else if (typeof statusCode === "number") {
      status = statusCode;
    }
  } else {
    meta = metaOrMessage;
    if (typeof messageOrStatusCode === "string") {
      message = messageOrStatusCode;
      status = statusCode;
    } else {
      status = typeof messageOrStatusCode === "number" ? messageOrStatusCode : 200;
    }
  }

  const response: ApiSuccessResponse = {
    success: true,
    status,
    message,
    data,
  };

  if (meta) {
    response.meta = meta;
  }

  if (authData) {
    if (authData.token) {response.token = authData.token;}
    if (authData.refreshToken) {response.refreshToken = authData.refreshToken;}
    if (authData.session) {response.session = authData.session;}
  }

  return res.status(status).json(response);
};

/**
 * Send an error response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 400)
 * @param {*} details - Optional error details (development only)
 * @param {Object|null} [extra] - top-level fields to add (field `errors`, a
 *   `requestId` for a generic production error — controllerWrapper, A-132)
 */
const error = (
  res: Response,
  message: string,
  statusCode = 400,
  details: unknown = null,
  extra: Record<string, unknown> | null = null,
): Response => {
  const response: ApiErrorResponse = {
    success: false,
    status: statusCode,
    message,
    data: null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    ...(extra || {}),
  };

  // Include details only in development
  if (!isProduction() && details) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send a service result envelope `{ success, status, message, data }` down the
 * path its status belongs on (A-103).
 *
 * Many services RETURN their not-found (404) and state-conflict (409) outcomes
 * rather than throwing them. A controller that forwards every result through
 * `success(res, result.data, null, result.message, result.status)` sends those
 * with `success: true` — the HTTP status says 404 while the body says it
 * worked, and a client that reads `success` shows an empty record as found.
 *
 * A status of 400 or more, or `success: false`, goes out through `error()`
 * (`success: false`, `data: null`). A `success: false` result that carries a
 * 2xx status is contradictory; it is answered 500 rather than trusted either
 * way. Everything else goes through `success()`, with `meta` (when given) as
 * the top-level sibling of `data`.
 *
 * @param {import('express').Response} res
 * @param {{success?: boolean, status?: number, message?: string, data?: *}} result
 * @param {Object|null} [meta] - pagination for a list; ignored on the error path
 */
const sendResult = (res: Response, result: ServiceResult, meta: object | null = null): Response => {
  const status = typeof result.status === "number" ? result.status : 200;
  if (status >= 400 || result.success === false) {
    return error(
      res,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" falls back
      result.message || "Request failed",
      status >= 400 ? status : 500,
    );
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" falls back
  return success(res, result.data, meta, result.message || "success", status);
};

/**
 * Send a not found response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Not found message
 */
const notFound = (res: Response, message = "Resource not found"): Response => {
  return error(res, message, 404);
};

/**
 * Send a bad request response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Validation error message
 */
const badRequest = (res: Response, message = "Bad request"): Response => {
  return error(res, message, 400);
};

/**
 * Send an unauthorized response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Unauthorized message
 */
const unauthorized = (res: Response, message = "Unauthorized"): Response => {
  return error(res, message, 401);
};

/**
 * Send a forbidden response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Forbidden message
 */
const forbidden = (res: Response, message = "Forbidden"): Response => {
  return error(res, message, 403);
};

/**
 * Send a login response with token and session
 * @param {import('express').Response} res - Express response object
 * @param {*} data - User data
 * @param {string} token - JWT token
 * @param {Object} session - Session object
 * @param {string} message - Success message
 */
/**
 * A sign-in answer: the access token, the session, and — since P6-02
 * (ADR-077) — the opaque refresh token. The Next login route
 * (frontend/src/app/api/v1/auth/login/route.ts) takes `refreshToken` off this
 * body into an httpOnly cookie and never forwards it to the browser; it was
 * never sent, so no session could be renewed and every sign-in ended when its
 * 15-minute access token did (found by the live E2E suite, whose refresh tests
 * had passed with no assertion).
 */
/** A session, as far as the sign-in answer reads it. */
interface SessionLike {
  id?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
}

const login = (
  res: Response,
  data: unknown,
  token: unknown,
  session: SessionLike | null | undefined,
  { refreshToken = null, message = "Login successful" }: { refreshToken?: unknown; message?: string } = {},
): Response => {
  return success(res, data, null, message, 200, {
    token,
    refreshToken,
    session: session
      ? {
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      }
      : null,
  });
};
/** One page of `items`, as `paginate` returns it. */
interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const paginate = <T>(items: T[], page: unknown = 1, limit: unknown = 10, total: number | null = null): Page<T> => {
  const pageNum = Number(page);
  const limitNum = Number(limit);
  // `??` is the same here: the default parameter turns an undefined total into null.
  const totalItems = total ?? items.length;
  const offset = (pageNum - 1) * limitNum;
  const paginatedItems = items.slice(offset, offset + limitNum);

  return {
    data: paginatedItems,
    total: totalItems,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(totalItems / limitNum),
  };
};

export {
  success,
  error,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  paginate,
  login,
  sendResult,
};
