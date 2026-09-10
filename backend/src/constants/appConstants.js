/**
 * Application Constants
 *
 * Centralized application-wide constants including pagination, OTP, password,
 * session, backup, rate limiting, and HTTP settings.
 */

// =============================================================================
// HTTP STATUS CODES
// =============================================================================
const HTTP_STATUS = {
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
};

// =============================================================================
// DEFAULT PAGINATION SETTINGS
// =============================================================================
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

// =============================================================================
// USER STATUS VALUES
// =============================================================================
const USER_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
};

// =============================================================================
// OTP SETTINGS
// =============================================================================
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_REQUESTS = 3;
const OTP_REQUEST_WINDOW_MINUTES = 15;

// =============================================================================
// PASSWORD SETTINGS
// =============================================================================
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_SALT_ROUNDS = 12;

// =============================================================================
// SESSION SETTINGS
// =============================================================================
const DEFAULT_SESSION_EXPIRY_HOURS = 24;
const MAX_SESSIONS_PER_USER = 5;

// =============================================================================
// BACKUP SETTINGS
// =============================================================================
const DEFAULT_BACKUP_RETENTION_DAYS = 90;
const MAX_BACKUP_RETENTION_DAYS = 3650;
const BACKUP_DIR = "backups";

// =============================================================================
// FILE UPLOAD SETTINGS
// =============================================================================
const FILE_UPLOAD = {
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
};

// =============================================================================
// REDIS LOCK & CACHE TTL (milliseconds)
// =============================================================================
const REDIS = {
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
};

// =============================================================================
// DATE/TIME CONSTANTS (milliseconds)
// =============================================================================
const TIME = {
  SECONDS: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  // 7 days (refresh token expiry)
  WEEK: 7 * 24 * 60 * 60 * 1000,
  // 15 minutes (account lockout)
  FIFTEEN_MINUTES: 15 * 60 * 1000,
};

// =============================================================================
// DEFAULT TENANT CONSTANT
// =============================================================================
const DEFAULT_TENANT = {
  id: "d3b07384-d113-49cd-a5d6-8ee00d5db6ef",
  name: "Default Hospital Tenant",
  subdomain: "default",
  email: "default@tenant.com",
  plan: "enterprise",
  status: "active",
  code: "DEFAULT",
};

module.exports = {
  DEFAULT_TENANT,

  // HTTP Status codes
  HTTP_STATUS,

  // Pagination
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,

  // User
  USER_STATUS,

  // OTP
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_REQUESTS,
  OTP_REQUEST_WINDOW_MINUTES,

  // Password
  PASSWORD_MIN_LENGTH,
  PASSWORD_SALT_ROUNDS,

  // Session
  DEFAULT_SESSION_EXPIRY_HOURS,
  MAX_SESSIONS_PER_USER,

  // Backup
  DEFAULT_BACKUP_RETENTION_DAYS,
  MAX_BACKUP_RETENTION_DAYS,
  BACKUP_DIR,

  // File upload
  FILE_UPLOAD,

  // Redis
  REDIS,

  // Time
  TIME,
};
