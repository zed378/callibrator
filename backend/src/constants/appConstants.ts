/**
 * Application Constants
 *
 * Centralized application-wide constants including pagination, OTP, password,
 * session, backup, rate limiting, and HTTP settings.
 *
 * P9-08 (ADR-087): converted from appConstants.js with no behaviour change.
 * The declarations are in the order module.exports listed them, so the
 * module's keys come out in the same order. `as const` types the values as
 * literals and emits nothing: every object here is as mutable at run time as
 * it was before, and nothing is frozen that was not.
 */

// =============================================================================
// DEFAULT TENANT CONSTANT
// =============================================================================
export const DEFAULT_TENANT = {
  id: "d3b07384-d113-49cd-a5d6-8ee00d5db6ef",
  name: "Default Hospital Tenant",
  subdomain: "default",
  email: "default@tenant.com",
  plan: "enterprise",
  status: "active",
  code: "DEFAULT",
} as const;

// =============================================================================
// CLIENT ADDRESS — `trust proxy` (A-16)
// =============================================================================
// req.ip is what sessions.ip_address, audit_logs.ipAddress,
// e_signature_records.ipAddress (21 CFR Part 11 evidence) and the per-IP auth
// limiter record. Express derives it from X-Forwarded-For, walking in from the
// RIGHT and trusting TRUST_PROXY_HOPS entries: with 1, req.ip is the rightmost
// entry — the one the directly-connected proxy wrote — and every entry to its
// left, which a client could have typed, is ignored.
//
// That is correct because EVERY proxy adjacent to the backend sends exactly
// one entry, the client address, and never forwards a client's own value:
//
//   /api/*       edge -> nginx -> Next.js -> backend
//                nginx OVERWRITES X-Forwarded-For with $remote_addr (after the
//                realip module has resolved the edge's header, VM only); Next's
//                proxy routes forward ONE sanitized address (frontend
//                src/lib/clientIp.ts) and drop every other address header.
//   /socket.io/, /uploads/public/, /oidc/, /health
//                edge -> nginx -> backend — nginx overwrites, as above.
//
// So one hop is right for both paths, and it must not be raised: a count above
// the real number of proxies hands req.ip to whatever the client put in the
// header. See deploy/compose/nginx/*.conf.
export const TRUST_PROXY_HOPS = 1;

// =============================================================================
// HTTP STATUS CODES
// =============================================================================
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// =============================================================================
// UPLOAD PLACEHOLDER
// =============================================================================
// The filename stored in users.avatar_url and tenants.logo when no file has
// been uploaded. It is a SENTINEL, not a file: nothing ships a default.svg,
// and `uploads/` is runtime volume data, so any URL built from it 404s.
//
// The service layer already treats it as "not a real upload" — the avatar and
// logo replace paths refuse to unlink it. The URL builders did not, which is
// why every seeded user rendered a broken image instead of the initials
// fallback the UI already has.
export const DEFAULT_UPLOAD_PLACEHOLDER = "default.svg";

// =============================================================================
// DEFAULT PAGINATION SETTINGS
// =============================================================================
export const DEFAULT_PAGE = 1;
// P9-22 (ADR-097): the page sizes are canonical in @callibrator/contracts, because
// the list-query schemas that bound `limit` are a contract; same bindings re-exported.
export { DEFAULT_LIMIT, MAX_LIMIT } from "@callibrator/contracts/pagination";

// =============================================================================
// USER STATUS VALUES
// =============================================================================
export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;

/** One `users.status` value. */
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

// =============================================================================
// OTP SETTINGS
// =============================================================================
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_REQUESTS = 3;
export const OTP_REQUEST_WINDOW_MINUTES = 15;

// =============================================================================
// PASSWORD SETTINGS
// =============================================================================
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_SALT_ROUNDS = 12;

// =============================================================================
// SESSION SETTINGS
// =============================================================================
export const DEFAULT_SESSION_EXPIRY_HOURS = 24;
export const MAX_SESSIONS_PER_USER = 5;

// =============================================================================
// BACKUP SETTINGS
// =============================================================================
export const DEFAULT_BACKUP_RETENTION_DAYS = 90;
export const MAX_BACKUP_RETENTION_DAYS = 3650;
export const BACKUP_DIR = "backups";

// =============================================================================
// FILE UPLOAD SETTINGS
// =============================================================================
export const FILE_UPLOAD = {
  // 5MB default
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  // 2MB for avatars
  AVATAR_MAX_FILE_SIZE: 2 * 1024 * 1024,
  ALLOWED_AVATAR_MIMES: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  ALLOWED_AVATAR_EXTENSIONS: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  ALLOWED_LOGO_MIMES: [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ],
  ALLOWED_LOGO_EXTENSIONS: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
} as const;

// =============================================================================
// REDIS LOCK & CACHE TTL (milliseconds)
// =============================================================================
export const REDIS = {
  // 5 seconds default lock TTL
  DEFAULT_LOCK_TTL: 5000,
  // Cache TTL values (milliseconds)
  CACHE_TTL: {
    SHORT: 60 * 1000, // 1 minute
    MEDIUM: 5 * 60 * 1000, // 5 minutes
    LONG: 15 * 60 * 1000, // 15 minutes
    HOUR: 60 * 60 * 1000, // 1 hour
    DAY: 24 * 60 * 60 * 1000, // 24 hours
  },
} as const;

// =============================================================================
// DATE/TIME CONSTANTS (milliseconds)
// =============================================================================
export const TIME = {
  SECONDS: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  // 7 days (refresh token expiry)
  WEEK: 7 * 24 * 60 * 60 * 1000,
  // 15 minutes (account lockout)
  FIFTEEN_MINUTES: 15 * 60 * 1000,
} as const;
