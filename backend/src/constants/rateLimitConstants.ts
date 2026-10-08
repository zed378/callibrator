/**
 * Rate Limit Configuration Constants
 *
 * Single source of truth for all rate limiting configurations.
 * Used by the Redis-backed rate limiter service.
 *
 * P9-08 (ADR-087): converted from rateLimitConstants.js with no behaviour
 * change. The export list keeps the old module.exports order; `satisfies` and
 * `as const` are types only.
 */

/** One authentication limiter's settings. */
export interface AuthLimit {
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly lockoutMs: number;
  readonly description: string;
  readonly persistUserLockout?: boolean;
}

/** One API limiter's settings. */
export interface ApiLimit {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly description: string;
}

// Window durations in milliseconds
const WINDOW = {
  MINUTE: 60 * 1000,
  FIFTEEN_MIN: 15 * 60 * 1000,
  FIVE_MIN: 5 * 60 * 1000,
  HOUR: 60 * 60 * 1000,
} as const;

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
  // A-37 (ADR-075, Q-18 for SCIM): the same budget for a SCIM credential —
  // an API key scoped scim:write provisions users with tenant-admin power.
  // Keyed by the API KEY id (never the target address), so each key an
  // administrator mints has its own ten answers an hour, each one audited.
  // persistUserLockout: false — the id is a key's, not an account's.
  scimIdentityConflict: {
    maxAttempts: 10,
    windowMs: WINDOW.HOUR,
    lockoutMs: WINDOW.HOUR,
    description: "SCIM user identity conflicts",
    persistUserLockout: false,
  },
} satisfies Record<string, AuthLimit>;

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
  // ---------------------------------------------------------------------
  // ADR-100 (A-291) — REQUEST budgets for the public authentication and verification
  // endpoints. Unlike AUTH_ENDPOINTS these count EVERY request, successes
  // included (middlewares/requestBudget.middleware.ts), so a caller cannot
  // send unlimited registrations, OTP mails or SSO starts by succeeding.
  // Per client address (req.ip, A-16) unless the entry says otherwise. The
  // figures are PRODUCTION figures: a hospital signs in from behind one NAT
  // address, so the per-address sign-in budget is generous; the per-account
  // defences stay AUTH_ENDPOINTS' failure throttles (A-185, A-81).
  // ---------------------------------------------------------------------
  authSignIn: {
    maxRequests: 300,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Sign-in",
  },
  authRegister: {
    maxRequests: 10,
    windowMs: WINDOW.HOUR,
    description: "Registration",
  },
  authOtp: {
    maxRequests: 20,
    windowMs: WINDOW.HOUR,
    description: "Password reset",
  },
  // Keyed by the (hashed) address a code is mailed to, whoever asks: the
  // bound on mail sent to one mailbox. Counted whether or not an account
  // exists, so a 429 here says nothing about the address.
  authOtpRecipient: {
    maxRequests: 3,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Password reset for this address",
  },
  ssoStart: {
    maxRequests: 60,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Single sign-on",
  },
  mfaSignIn: {
    maxRequests: 60,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Second-factor sign-in",
  },
  // Public certificate verification: a lookup by the bare certificate number
  // (the minimal verdict) and by the QR's verification token (the full one).
  certificateVerify: {
    maxRequests: 60,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Certificate verification",
  },
  certificateVerifyToken: {
    maxRequests: 300,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Certificate verification",
  },
  // P21-04 (P19-06 § 8.1): the public IPM report verification — every request (300) and every
  // answer that is not a verdict (60), per address (ADR-100's pair); and the IPM report signature,
  // per user and address (a credential is checked — the A-185 class).
  ipmVerifyToken: {
    maxRequests: 300,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "IPM report verification",
  },
  ipmVerify: {
    maxRequests: 60,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "IPM report verification",
  },
  ipmSignature: {
    maxRequests: 10,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "IPM report signing",
  },
  // ---------------------------------------------------------------------
  // Phase 10 (ADR-098) — the public ways in, per client address.
  // ---------------------------------------------------------------------
  // P10-05: the access-request intake. A person sends one; five an hour from
  // one address leaves room for a hospital's shared NAT and stops a flood (the
  // service also caps stored requests per work email, 3 per 24 h).
  accessRequest: {
    maxRequests: 5,
    windowMs: WINDOW.HOUR,
    description: "Access request",
  },
  // P10-04: identifier-first discovery. Answered by email DOMAIN only, so it
  // is no account oracle; the budget stops a crawl of which domains use SSO.
  loginDiscover: {
    maxRequests: 120,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Sign-in discovery",
  },
  // P10-10: the passwordless passkey ceremony (options + verify), per address:
  // no identifier is known before verification.
  passkeyLogin: {
    maxRequests: 60,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Passkey sign-in",
  },
  // P10-15: accepting an invitation. The token is 256 random bits; this stops
  // a client hammering the endpoint, not guessing.
  invitationAccept: {
    maxRequests: 20,
    windowMs: WINDOW.FIFTEEN_MIN,
    description: "Invitation",
  },
} satisfies Record<string, ApiLimit>;

/**
 * The two tables read by an arbitrary key. The lookup is the plain property
 * read it always was (an unknown key is `undefined`); typed so the fallback
 * below is visible to the checker.
 */
const AUTH_TABLE: Readonly<Record<string, AuthLimit | undefined>> = AUTH_ENDPOINTS;
const API_TABLE: Readonly<Record<string, ApiLimit | undefined>> = API_ENDPOINTS;

/**
 * Get config for an auth endpoint.
 * @param {string} endpoint - Endpoint key (login, register, forgotPassword, resetPassword)
 * @returns {object} Config object
 */
function getAuthConfig(endpoint: string): AuthLimit {
  // `??` is `||` here: every value in the table is an object, never falsy.
  return AUTH_TABLE[endpoint] ?? AUTH_ENDPOINTS.login;
}

/**
 * Get config for an API endpoint.
 * @param {string} endpoint - Endpoint key (tenantCreate, tenantUpload, etc.)
 * @returns {object} Config object
 */
function getApiConfig(endpoint: string): ApiLimit {
  // `??` is `||` here: every value in the table is an object, never falsy.
  return API_TABLE[endpoint] ?? API_ENDPOINTS.default;
}

/**
 * Generate a Redis key for rate limiting.
 * @param {string} type - 'auth' or 'api'
 * @param {string} endpoint - Endpoint identifier
 * @param {string} identifier - User ID, token hash, IP, etc.
 * @returns {string} Redis key
 */
function makeKey(type: string, endpoint: string, identifier: string): string {
  return `ratelimit:${type}:${endpoint}:${identifier}`;
}

export { AUTH_ENDPOINTS, API_ENDPOINTS, WINDOW, getAuthConfig, getApiConfig, makeKey };
