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
 */

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
  res,
  data = null,
  metaOrMessage = null,
  messageOrStatusCode = null,
  statusCode = 200,
  authData = null,
) => {
  let meta = null;
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

  const response = {
    success: true,
    status,
    message,
    data,
  };

  if (meta) {
    response.meta = meta;
  }

  if (authData) {
    if (authData.token) response.token = authData.token;
    if (authData.session) response.session = authData.session;
  }

  return res.status(status).json(response);
};

/**
 * Send an error response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 400)
 * @param {*} details - Optional error details (development only)
 */
const error = (res, message, statusCode = 400, details = null) => {
  const response = {
    success: false,
    status: statusCode,
    message,
    data: null,
  };

  // Include details only in development
  if (process.env.NODE_ENV !== "production" && details) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send a paginated success response
 * @param {import('express').Response} res - Express response object
 * @param {Array} rows - Array of data rows
 * @param {number} count - Total count of records
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {Object} customCounts - Additional custom counts (optional)
 */
const paginated = (
  res,
  rows,
  count,
  message = "Success",
  statusCode = 200,
  customCounts = {},
) => {
  const { page = 1, limit = 20 } = res.query || {};

  const meta = {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  };

  // Add custom counts if provided
  if (Object.keys(customCounts).length > 0) {
    meta.customCounts = customCounts;
  }

  return success(res, rows, meta, message, statusCode);
};

/**
 * Send a not found response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Not found message
 */
const notFound = (res, message = "Resource not found") => {
  return error(res, message, 404);
};

/**
 * Send a bad request response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Validation error message
 */
const badRequest = (res, message = "Bad request") => {
  return error(res, message, 400);
};

/**
 * Send an unauthorized response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Unauthorized message
 */
const unauthorized = (res, message = "Unauthorized") => {
  return error(res, message, 401);
};

/**
 * Send a forbidden response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Forbidden message
 */
const forbidden = (res, message = "Forbidden") => {
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
const login = (res, data, token, session, message = "Login successful") => {
  return success(res, data, null, message, 200, {
    token,
    session: session
      ? {
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      }
      : null,
  });
};
const paginate = (items, page = 1, limit = 10, total = null) => {
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const totalItems = total !== null ? total : items.length;
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

module.exports = {
  success,
  error,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  paginated,
  paginate,
  login,
};
