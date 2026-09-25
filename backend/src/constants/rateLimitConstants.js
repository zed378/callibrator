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
  // A-185: the password sign-in throttle is keyed by the typed identifier
  // TOGETHER WITH the caller's address (rateLimiter.redis.service
  // #checkLoginThrottle) — five failures of one name from one address pause
  // that pair for fifteen minutes. It never writes users.locked_until, and it
  // answers an unknown name exactly as a real one.
  login: {
    maxAttempts: 5,
    windowMs: WINDOW.FIFTEEN_MIN,
    lockoutMs: WINDOW.FIFTEEN_MIN,
    description: "Login endpoint",
  },
  // A-185: the ceiling on ONE identifier across every address — the defence
  // against a guesser who rotates addresses. 100 is NIST SP 800-63B §5.2.2's
  // upper bound on consecutive failures for one account. Reaching it pauses
  // that identifier everywhere for an hour, which a determined attacker can
  // trigger on purpose; that residual is accepted and recorded (ADR draft in
  // the A-185 record) because without a ceiling a botnet guesses unbounded.
  loginIdentifier: {
    maxAttempts: 100,
    windowMs: WINDOW.HOUR,
    lockoutMs: WINDOW.HOUR,
    description: "Login ceiling per identifier",
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
  // A-60: the SSO hand-off code exchange. The code is 256 random bits, so this
  // is not what stops guessing — it stops a client hammering the endpoint. No
  // user id is known before a code redeems, so only the per-IP counter applies,
  // and it locks at maxAttempts * 3 failures (rateLimiter.redis.service.js).
  ssoExchange: {
    maxAttempts: 10,
    windowMs: WINDOW.FIVE_MIN,
    lockoutMs: WINDOW.FIVE_MIN,
    description: "SSO hand-off code exchange",
  },
  // A-81: the TOTP step of an MFA login. Five wrong codes for one user lock
  // that user for fifteen minutes (and write users.locked_until, which both
  // login steps honour), however many MFA tokens the attempts were spread
  // over. Five guesses at a 10^6 space per quarter hour is noise; the
  // unlimited endpoint it replaces was a brute force.
  mfaLogin: {
    maxAttempts: 5,
    windowMs: WINDOW.FIFTEEN_MIN,
    lockoutMs: WINDOW.FIFTEEN_MIN,
    description: "MFA login (TOTP code)",
  },
  // A-142: the SIGNED-IN MFA endpoints — /auth/mfa/setup (a rotation checks
  // the current password and a current code), /auth/mfa/verify (a code from
  // the new authenticator) and /auth/mfa/disable (password and a code). One
  // bucket for all three, keyed by the user, so spreading guesses across them
  // buys nothing. Per IP too when AUTH_RATE_LIMIT_BY_IP is on.
  //
  // persistUserLockout: false — the lock is on these endpoints only. It does
  // NOT write users.locked_until (which blocks SIGN-IN): whoever is guessing
  // here already holds a session, so locking sign-in would only lock out the
  // real user, and a success here must not clear a sign-in lock either.
  mfaManage: {
    maxAttempts: 5,
    windowMs: WINDOW.FIFTEEN_MIN,
    lockoutMs: WINDOW.FIFTEEN_MIN,
    description: "MFA setup, verification and disable",
    persistUserLockout: false,
  },
  // A-260 (ADR-072): every check of the CALLER'S OWN password by a signed-in
  // session — POST /auth/pass-is-valid, the change-password route, and the
  // re-authentication of a passkey removal, an email rectification and an MFA
  // rotation or disable (auth.service#verifySessionPassword). One bucket per
  // user across all of them, so spreading guesses buys nothing. Five wrong
  // passwords in fifteen minutes pause every one of these checks for that
  // user and sign out the session that made them.
  //
  // persistUserLockout: false — as for mfaManage: the guesser already holds a
  // session, so locking SIGN-IN would lock out only the real user, and a
  // success here must not clear a sign-in lock either.
  passwordCheck: {
    maxAttempts: 5,
    windowMs: WINDOW.FIFTEEN_MIN,
    lockoutMs: WINDOW.FIFTEEN_MIN,
    description: "Signed-in password checks",
    persistUserLockout: false,
  },
  // A-128 (ADR-051 Q-18): a tenant administrator's user create / identity edit
  // that hits a username or email already registered — possibly in another
  // tenant, the residual existence oracle Q-18 accepts. Keyed by the
  // administrator (never the target). Ten per hour covers honest typos and
  // re-invitations; a probe gets ten answers an hour, each one audited.
  // persistUserLockout: false — it limits user administration only, never
  // the administrator's own sign-in.
  userIdentityConflict: {
    maxAttempts: 10,
    windowMs: WINDOW.HOUR,
    lockoutMs: WINDOW.HOUR,
    description: "User create/edit identity conflicts",
    persistUserLockout: false,
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
