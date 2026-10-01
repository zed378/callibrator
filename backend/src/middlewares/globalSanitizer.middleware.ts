// P9-19 (ADR-087): converted from globalSanitizer.middleware.js with no
// behaviour change. `xss` is the CommonJS function itself (a default import).
import type { NextFunction, Request, Response } from "express";
import xss from "xss";

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
function sanitize(data: unknown, parentKey = ""): unknown {
  // Skip excluded fields (likely binary/base64)
  if (EXCLUDED_FIELDS.includes(parentKey)) {
    return data;
  }

  if (typeof data === "string") {
    return xss(data);
  }
  if (Array.isArray(data)) {
    return data.map((item: unknown) => sanitize(item, parentKey));
  }
  if (data && typeof data === "object") {
    const sanitizedObject: Record<string, unknown> = {};
    const source = data as Record<string, unknown>;
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        sanitizedObject[key] = sanitize(source[key], key);
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
function sanitizeInPlace(obj: unknown): void {
  if (!obj || typeof obj !== "object") {
    return;
  }
  const target = obj as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    target[key] = sanitize(target[key], key);
  }
}

/**
 * Sanitize a parsed request body: the body branch of globalSanitizer, and the
 * ONE rule for every body whatever its content type.
 *
 * A-296: globalSanitizer runs app-wide, before the routers, so it sees a JSON
 * or urlencoded body but never a multipart one — multer parses that later,
 * inside the route. utils/upload.util calls this as soon as multer has parsed
 * the fields, so a multipart body is escaped exactly like its JSON twin
 * (guards/multipartSanitizer.a296.guard.test.ts keeps every multer use there).
 *
 * Express types body as `any`; at run time a body can be absent (A-09) and a
 * test can pass anything, so it is read as `unknown` and every check the .js
 * made is still made, reading the property as often as it did. The body is
 * writable — it is reassigned to a fresh sanitized object (which also drops
 * any inherited/prototype-chain properties, and multer's null prototype).
 */
function sanitizeParsedBody(req: Request): void {
  if ((req.body as unknown) && typeof (req.body as unknown) === "object") {
    req.body = sanitize(req.body as unknown);
  }
}

/**
 * Global XSS Sanitizer Middleware
 * Sanitizes all incoming request data to prevent XSS attacks
 */
const globalSanitizer = (req: Request, _res: Response, next: NextFunction): void => {
  // Params are always an object in Express's types; they are read as
  // `unknown` for the same reason as the body (sanitizeParsedBody).
  sanitizeParsedBody(req);

  // In Express 5 `req.query` is a getter with no setter and cannot be
  // reassigned; mutate its own properties in place instead.
  sanitizeInPlace(req.query);

  if ((req.params as unknown) && typeof (req.params as unknown) === "object") {
    req.params = sanitize(req.params) as Request["params"];
  }

  next();
};

export { globalSanitizer, sanitizeParsedBody };
