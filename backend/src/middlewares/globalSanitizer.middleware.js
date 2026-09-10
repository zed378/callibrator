const xss = require("xss");

// Fields that should NOT be sanitized (binary/base64-like content)
const EXCLUDED_FIELDS = [
  "avatar_url",
  "avatar",
  "signature",
  "file_content",
  "content_base64",
];

/**
 * Recursively sanitize a value
 */
function sanitize(data, parentKey = "") {
  // Skip excluded fields (likely binary/base64)
  if (EXCLUDED_FIELDS.includes(parentKey)) {
    return data;
  }

  if (typeof data === "string") {
    return xss(data);
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, parentKey));
  }
  if (data && typeof data === "object") {
    const sanitizedObject = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        sanitizedObject[key] = sanitize(data[key], key);
      }
    }
    return sanitizedObject;
  }
  return data;
}

/**
 * Sanitize an object's string values IN PLACE.
 *
 * In Express 5 `req.query` is a getter with no setter, so it cannot be
 * reassigned (doing so throws). We mutate the existing object's own
 * enumerable properties instead, which works for `req.query`, `req.params`
 * and `req.body` alike.
 */
function sanitizeInPlace(obj) {
  if (!obj || typeof obj !== "object") {
    return;
  }
  for (const key of Object.keys(obj)) {
    obj[key] = sanitize(obj[key], key);
  }
}

/**
 * Global XSS Sanitizer Middleware
 * Sanitizes all incoming request data to prevent XSS attacks
 */
const globalSanitizer = (req, res, next) => {
  // Body and params are writable — reassign to a fresh sanitized object
  // (this also drops any inherited/prototype-chain properties).
  if (req.body && typeof req.body === "object") {
    req.body = sanitize(req.body);
  }

  // In Express 5 `req.query` is a getter with no setter and cannot be
  // reassigned; mutate its own properties in place instead.
  sanitizeInPlace(req.query);

  if (req.params && typeof req.params === "object") {
    req.params = sanitize(req.params);
  }

  next();
};

module.exports = { globalSanitizer };
