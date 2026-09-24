// auth.controller.js
const { AppError } = require("../utils/appError.util");
const authService = require("../services/auth.service");
const {
  asyncHandlerWithMapping,
  resolveErrorStatus,
} = require("../utils/controllerWrapper.util");
const { success, login } = require("../utils/response.util");
const {
  noteAuthFailure,
  noteAuthSuccess,
} = require("../services/rateLimiter.redis.service");
const { logger } = require("../middlewares/activityLog.middleware");
const {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  validate,
} = require("../validators/auth.validator");

// ------------------------------------------------------------------
// A-67 — RATE-LIMIT OUTCOME
//
// authPreCheck (auth.route.js) refuses a locked-out caller and attaches
// `req.rateLimitContext`; only the handler knows how the attempt ended, so the
// handler records it. A 4xx other than 429 counts as a failure and is recorded
// BEFORE the error response goes out; a 5xx is our fault and is not held
// against the caller; a success clears the per-user/per-token counters.
//
// The status is resolved from the SAME error map asyncHandlerWithMapping uses,
// so what is counted is exactly what the client is answered with.
//
// The failure is also logged (winston, `warn`) with its real reason — the
// client sees only the mapped message. audit_logs has no failure action
// (ENUM: CREATE, UPDATE, DELETE, LOGIN, APPROVE, EXPORT), and an unknown
// username has no tenant to write the NOT NULL tenant_id with, so a failed
// attempt writes no audit row (A-72).
// ------------------------------------------------------------------

/**
 * @param {string} endpoint - AUTH_ENDPOINTS key
 * @param {Record<string, number>} errorMap - the map the handler is wrapped with
 * @param {(req: object, res: object) => Promise<unknown>} handler
 * @returns {(req: object, res: object) => Promise<unknown>}
 */
const withAuthOutcome = (endpoint, errorMap, handler) => async (req, res) => {
  let result;
  try {
    result = await handler(req, res);
  } catch (error) {
    const status = resolveErrorStatus(error, errorMap);
    if (status >= 400 && status < 500 && status !== 429) {
      await noteAuthFailure(req, endpoint);
      logger.warn("Authentication attempt failed", {
        endpoint,
        status,
        reason: error.message,
        ip: req.ip || null,
      });
    }
    throw error;
  }
  await noteAuthSuccess(req, endpoint);
  return result;
};

/**
 * The address and user agent an audit row records — from the request itself,
 * never the body.
 *
 * @param {object} req
 * @returns {{ipAddress: string|null, userAgent: string|null}}
 */
const requestContext = (req) => ({
  ipAddress: req.ip || null,
  userAgent: req.headers?.["user-agent"] || null,
});

const REGISTER_ERRORS = { registered: 409, used: 409 };
const LOGIN_ERRORS = {
  credentials: 401,
  verify: 403,
  suspended: 403,
  locked: 423,
};
const SEND_OTP_ERRORS = { wait: 429, verified: 403 };
const RESET_PASSWORD_ERRORS = {};

exports.register = asyncHandlerWithMapping(
  withAuthOutcome("register", REGISTER_ERRORS, async (req, res) => {
    validate(req.body, registerSchema);

    const origin = req.headers.origin || req.headers.host || "";

    await authService.registerUser(req.body, origin);

    success(
      res,
      null,
      null,
      "Registration successful. Please check your email for activation.",
      201,
    );
  }),
  REGISTER_ERRORS,
);

exports.activation = asyncHandlerWithMapping(
  async (req, res) => {
    const { token } = req.query;
    if (!token) {
      throw new AppError(400, "Activation token is required");
    }

    await authService.activateAccount(token);

    success(res, null, null, "Account activated successfully", 200);
  },
  {
    "not found": 404,
  },
);

exports.login = asyncHandlerWithMapping(
  withAuthOutcome("login", LOGIN_ERRORS, async (req, res) => {
    validate(req.body, loginSchema);

    const result = await authService.loginUser({
      ...req.body,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    login(res, result.data, result.token, result.session);
  }),
  LOGIN_ERRORS,
);

exports.sendOTP = asyncHandlerWithMapping(
  withAuthOutcome("forgotPassword", SEND_OTP_ERRORS, async (req, res) => {
    await authService.requestOTP(req.body);

    success(res, null, null, "If the account exists, OTP has been sent", 200);
  }),
  SEND_OTP_ERRORS,
);

exports.resetPassword = asyncHandlerWithMapping(
  withAuthOutcome("resetPassword", RESET_PASSWORD_ERRORS, async (req, res) => {
    validate(req.body, resetPasswordSchema);

    await authService.processResetPassword(req.body);

    success(res, null, null, "Password reset successful", 200);
  }),
  RESET_PASSWORD_ERRORS,
);

exports.logout = asyncHandlerWithMapping(async (req, res) => {
  await authService.logoutSession();
  success(res, null, null, "Logout successful", 200);
}, {});

exports.logoutAll = asyncHandlerWithMapping(async (req, res) => {
  await authService.logoutAllUserSessions(req.user.id);
  success(res, null, null, "All sessions revoked successfully", 200);
}, {});

exports.verify = asyncHandlerWithMapping(
  async (req, res) => {
    const result = await authService.verifyUserSession(
      req.user.id,
      req.session,
    );

    success(res, result.data, null, result.message, result.status);
  },
  {
    banned: 403,
  },
);

/**
 * Short-lived JWT for the socket.io handshake.
 * The app JWT lives in an httpOnly cookie the browser JS cannot read, so the
 * client requests this token (cookie-authenticated via the proxy) and passes
 * it as `auth.token` when opening the socket connection.
 */
exports.socketToken = asyncHandlerWithMapping(async (req, res) => {
  const { generatePurposeToken } = require("../utils/jwt.util");
  const expiresIn = 300; // seconds — shorter than JWT_ACCESS_EXPIRED on purpose
  // A-52 / A-59: a "socket" purpose token. It used to be jwt.sign()ed here with
  // no `typ`, which verifyAccessToken accepts — so this five-minute handshake
  // token was also a bearer access token. It now works ONLY at the socket
  // handshake (config/socket.js), and carries the caller's session (`sid`) so
  // the handshake refuses a revoked session.
  const token = generatePurposeToken(
    { id: req.user.id, sid: req.sessionId || undefined },
    "socket",
    { expiresIn },
  );
  success(
    res,
    { token, expiresIn },
    null,
    "Socket token issued successfully",
    200,
  );
}, {});

exports.justUpdatePassword = asyncHandlerWithMapping(async (req, res) => {
  const { id: userId } = req.user;
  const { newPassword, currentPassword } = req.body || {};
  // A-98 / F-12: the audit row the service writes carries the caller's
  // address and user agent.
  const result = await authService.justUpdatePassword(
    userId,
    newPassword,
    currentPassword,
    requestContext(req),
  );
  success(res, null, null, result.message, 200);
}, {});

exports.passIsValid = asyncHandlerWithMapping(async (req, res) => {
  const { id: userId } = req.user;
  const { password } = req.body || {};
  const result = await authService.passIsValid(userId, password);
  success(res, result.data, null, result.message, 200);
}, {});

// ------------------------------------------------------------------
// MFA (MULTI-FACTOR AUTHENTICATION)
// ------------------------------------------------------------------

// A-142: setup, verify and disable are rate-limited as one `mfaManage`
// bucket per user (mfaManagePreCheck, auth.route.js). A 4xx counts as a
// failed attempt and a success clears the count — `withAuthOutcome`, as on
// every other auth endpoint.

// A-114: on an account that already has MFA, setup is a ROTATION and needs
// `currentPassword` and a `code` from the current authenticator (409 without
// them). Both come from the body; the user is always the caller.
exports.setupMfa = asyncHandlerWithMapping(
  withAuthOutcome("mfaManage", {}, async (req, res) => {
    const { currentPassword, code } = req.body || {};
    const result = await authService.setupMfa(req.user.id, { currentPassword, code });
    success(res, result, null, "MFA secret generated", 200);
  }),
  {},
);

const MFA_VERIFY_ERRORS = { "Invalid MFA code": 400 };

// A-141: the response carries the new one-time recovery codes — the only
// time they are ever shown — at `data.recoveryCodes`. `sessionId` lets a
// rotation keep the caller's own session while every other one is revoked.
exports.verifyMfaSetup = asyncHandlerWithMapping(
  withAuthOutcome("mfaManage", MFA_VERIFY_ERRORS, async (req, res) => {
    const { code } = req.body || {};
    if (!code) {
      throw new AppError(400, "MFA code is required");
    }
    const result = await authService.verifyMfaSetup(req.user.id, code, {
      ...requestContext(req),
      sessionId: req.sessionId || null,
    });
    success(res, { recoveryCodes: result.recoveryCodes }, null, result.message, 200);
  }),
  MFA_VERIFY_ERRORS,
);

// A-141: turn MFA off. Needs `currentPassword` and either `code` (TOTP) or
// `recoveryCode`; every other session of the caller is signed out.
exports.disableMfa = asyncHandlerWithMapping(
  withAuthOutcome("mfaManage", {}, async (req, res) => {
    const { currentPassword, code, recoveryCode } = req.body || {};
    const result = await authService.disableMfa(
      req.user.id,
      { currentPassword, code, recoveryCode },
      { ...requestContext(req), sessionId: req.sessionId || null },
    );
    success(
      res,
      { otherSessionsRevoked: result.otherSessionsRevoked },
      null,
      result.message,
      200,
    );
  }),
  {},
);

// A-81: wrong codes count against the user, the MFA token and (when enabled)
// the address that mfaLoginPreCheck attached; a success clears the user and
// token counters.
const MFA_LOGIN_ERRORS = { "Invalid MFA code": 401 };

exports.loginMfa = asyncHandlerWithMapping(
  withAuthOutcome("mfaLogin", MFA_LOGIN_ERRORS, async (req, res) => {
    // A-141: `recoveryCode` is accepted in place of `code`.
    const { code, token, recoveryCode } = req.body || {};
    if ((!code && !recoveryCode) || !token) {
      throw new AppError(400, "MFA code and temporary token are required");
    }

    // Verify the temporary MFA token. A-59: only an "mfa" purpose token is
    // accepted here — an access token, an activation token or a socket token
    // is refused, and the mfa token is refused everywhere else.
    const { verifyPurposeToken } = require("../utils/jwt.util");
    let decoded;
    try {
      decoded = verifyPurposeToken(token, "mfa");
    } catch (err) {
      throw new AppError(401, "Invalid or expired login token");
    }

    if (!decoded.mfaRequired || !decoded.id) {
      throw new AppError(401, "Invalid token payload");
    }

    const result = await authService.loginMfa(
      decoded.id,
      code,
      req.ip,
      req.headers["user-agent"],
      { recoveryCode },
    );

    login(res, result.data, result.token, result.session);
  }),
  MFA_LOGIN_ERRORS,
);

// ------------------------------------------------------------------
// IMPERSONATION
// ------------------------------------------------------------------

exports.impersonateUser = asyncHandlerWithMapping(async (req, res) => {
  const { tenantId, userId } = req.body || {};
  if (!tenantId || !userId) {
    throw new AppError(400, "tenantId and userId are required");
  }

  const result = await authService.impersonateUser(
    req.user.id,
    tenantId,
    userId,
    req.ip,
    req.headers["user-agent"]
  );

  login(res, result.data, result.token, result.session);
}, {
  "Only Super Admins can impersonate users": 403,
  "Target user not found in the specified tenant": 404,
  "Cannot impersonate yourself": 400,
});

exports.refresh = asyncHandlerWithMapping(async (req, res) => {
  const { refreshToken, sessionId } = req.body || {};
  if (!refreshToken) {
    throw new AppError(400, "Refresh token is required");
  }
  const result = await authService.refreshUserToken(
    refreshToken,
    sessionId || null,
    req.ip,
    req.headers["user-agent"],
  );
  success(res, result.data, null, result.message, 200);
}, {});

// NOTE: setupMfa / verifyMfaSetup / loginMfa were previously DEFINED A SECOND
// TIME here, silently overwriting the implementations above. The duplicate
// loginMfa was a stub that threw 501 "MFA login flow not fully implemented",
// so POST /api/v1/auth/mfa/login could never work and authService.loginMfa
// (which verifies the temp token and issues the session) was unreachable dead
// code. The duplicates have been removed; the authService-backed handlers
// above — the only complete set — are now the live ones.
