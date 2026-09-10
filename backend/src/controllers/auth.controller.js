// auth.controller.js
const { AppError } = require("../utils/appError.util");
const authService = require("../services/auth.service");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");
const { success, login } = require("../utils/response.util");
const {
  registerSchema,
  loginSchema,
  resetPasswordSchema,
  validate,
} = require("../validators/auth.validator");

exports.register = asyncHandlerWithMapping(
  async (req, res) => {
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
  },
  {
    registered: 409,
    used: 409,
  },
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
  async (req, res) => {
    validate(req.body, loginSchema);

    const result = await authService.loginUser({
      ...req.body,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    login(res, result.data, result.token, result.session);
  },
  {
    credentials: 401,
    verify: 403,
    suspended: 403,
    locked: 423,
  },
);

exports.sendOTP = asyncHandlerWithMapping(
  async (req, res) => {
    await authService.requestOTP(req.body);

    success(res, null, null, "If the account exists, OTP has been sent", 200);
  },
  {
    wait: 429,
    verified: 403,
  },
);

exports.resetPassword = asyncHandlerWithMapping(async (req, res) => {
  validate(req.body, resetPasswordSchema);

  await authService.processResetPassword(req.body);

  success(res, null, null, "Password reset successful", 200);
}, {});

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
  const jwt = require("jsonwebtoken");
  const expiresIn = 300; // seconds — shorter than JWT_ACCESS_EXPIRED on purpose
  const token = jwt.sign(
    { id: req.user.id, purpose: "socket" },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn, algorithm: "HS256" },
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
  const { newPassword, currentPassword } = req.body;
  const result = await authService.justUpdatePassword(
    userId,
    newPassword,
    currentPassword,
  );
  success(res, null, null, result.message, 200);
}, {});

exports.passIsValid = asyncHandlerWithMapping(async (req, res) => {
  const { id: userId } = req.user;
  const { password } = req.body;
  const result = await authService.passIsValid(userId, password);
  success(res, result.data, null, result.message, 200);
}, {});

// ------------------------------------------------------------------
// MFA (MULTI-FACTOR AUTHENTICATION)
// ------------------------------------------------------------------

exports.setupMfa = asyncHandlerWithMapping(async (req, res) => {
  const result = await authService.setupMfa(req.user.id);
  success(res, result, null, "MFA secret generated", 200);
}, {});

exports.verifyMfaSetup = asyncHandlerWithMapping(async (req, res) => {
  const { code } = req.body;
  if (!code) {
    throw new AppError(400, "MFA code is required");
  }
  const result = await authService.verifyMfaSetup(req.user.id, code);
  success(res, null, null, result.message, 200);
}, {
  "Invalid MFA code": 400,
});

exports.loginMfa = asyncHandlerWithMapping(async (req, res) => {
  const { code, token } = req.body;
  if (!code || !token) {
    throw new AppError(400, "MFA code and temporary token are required");
  }
  
  // Verify the temporary MFA token
  const { verifyAccessToken } = require("../utils/jwt.util");
  let decoded;
  try {
    decoded = verifyAccessToken(token);
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
    req.headers["user-agent"]
  );

  login(res, result.data, result.token, result.session);
}, {
  "Invalid MFA code": 401,
});

// ------------------------------------------------------------------
// IMPERSONATION
// ------------------------------------------------------------------

exports.impersonateUser = asyncHandlerWithMapping(async (req, res) => {
  const { tenantId, userId } = req.body;
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
  const { refreshToken, sessionId } = req.body;
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
