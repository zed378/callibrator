/**
 * Rate Limit Configuration Constants
 *
 * Single source of truth for all rate limiting configurations.
 * Used by the Redis-backed rate limiter service.
 */

// Window durations in milliseconds
const WINDOW = {
  MINUTE: 60 * 1000,
  FIFTEEN_MIN: 15 * 60 * 1000,
  FIVE_MIN: 5 * 60 * 1000,
  HOUR: 60 * 60 * 1000,
};

/**
 * Rate limit configurations for auth endpoints (brute-force protection).
 * These track failures and can lock accounts/revoke tokens.
 */
const AUTH_ENDPOINTS = {
  login: {
    maxAttempts: 5,
    windowMs: WINDOW.FIFTEEN_MIN,
    lockoutMs: WINDOW.FIFTEEN_MIN,
    description: "Login endpoint",
  },
  register: {
    maxAttempts: 3,
    windowMs: WINDOW.HOUR,
    lockoutMs: WINDOW.HOUR,
    description: "Registration endpoint",
  },
  forgotPassword: {
    maxAttempts: 3,
    windowMs: WINDOW.FIFTEEN_MIN,
    lockoutMs: WINDOW.FIFTEEN_MIN,
    description: "Forgot password (OTP request)",
  },
  resetPassword: {
    maxAttempts: 5,
    windowMs: WINDOW.FIVE_MIN,
    lockoutMs: WINDOW.FIVE_MIN,
    description: "Reset password with OTP",
  },
};

/**
 * Rate limit configurations for generic API endpoints (request quota).
 * These return 429 with X-RateLimit-* headers but don't lock accounts.
 */
const API_ENDPOINTS = {
  tenantCreate: {
    maxRequests: 10,
    windowMs: WINDOW.MINUTE,
    description: "Tenant creation",
  },
  tenantUpload: {
    maxRequests: 20,
    windowMs: WINDOW.MINUTE,
    description: "Tenant logo/upload",
  },
  default: {
    maxRequests: 100,
    windowMs: WINDOW.MINUTE,
    description: "Default endpoint",
  },
};

/**
 * Get config for an auth endpoint.
 * @param {string} endpoint - Endpoint key (login, register, forgotPassword, resetPassword)
 * @returns {object} Config object
 */
function getAuthConfig(endpoint) {
  return AUTH_ENDPOINTS[endpoint] || AUTH_ENDPOINTS.login;
}

/**
 * Get config for an API endpoint.
 * @param {string} endpoint - Endpoint key (tenantCreate, tenantUpload, etc.)
 * @returns {object} Config object
 */
function getApiConfig(endpoint) {
  return API_ENDPOINTS[endpoint] || API_ENDPOINTS.default;
}

/**
 * Generate a Redis key for rate limiting.
 * @param {string} type - 'auth' or 'api'
 * @param {string} endpoint - Endpoint identifier
 * @param {string} identifier - User ID, token hash, IP, etc.
 * @returns {string} Redis key
 */
function makeKey(type, endpoint, identifier) {
  return `ratelimit:${type}:${endpoint}:${identifier}`;
}

module.exports = {
  AUTH_ENDPOINTS,
  API_ENDPOINTS,
  WINDOW,
  getAuthConfig,
  getApiConfig,
  makeKey,
};