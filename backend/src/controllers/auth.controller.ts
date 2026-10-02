// auth.controller.ts
//
// P9-20 (ADR-087; converted under the four isolation gates): from
// auth.controller.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order). The service
// and the rate limiter are captured at load as the `.js` destructured them;
// the lazy requires of jwt.util (socketToken, loginMfa) stay lazy. Request
// data is read through typed views of the request; the emitted expressions
// (`req.user.id` unguarded, `req.headers["user-agent"]`) and the TypeErrors a
// missing user throws are the `.js` ones.
import type { Request, Response } from "express";

import { AppError as LoadedAppError } from "../utils/appError.util";
import authService from "../services/auth.service";
import {
  asyncHandlerWithMapping as loadedAsyncHandlerWithMapping,
  resolveErrorStatus as loadedResolveErrorStatus,
} from "../utils/controllerWrapper.util";
import { success as loadedSuccess, login as loadedLogin } from "../utils/response.util";
import rateLimiter from "../services/rateLimiter.redis.service";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
// A-289 (ADR-100): emailed links are built on the configured origin only.
import { emailLinkOrigin as loadedEmailLinkOrigin } from "../utils/publicLinkOrigin.util";
import type * as JwtUtil from "../utils/jwt.util";
import type { UserId } from "../types/ids";
// P9-11: the body is checked by auth.service (register, login, reset); this
// controller's own calls discarded the result, so they are gone.

const AppError = LoadedAppError;
const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const resolveErrorStatus = loadedResolveErrorStatus;
const success = loadedSuccess;
const login = loadedLogin;
const { noteAuthFailure, noteAuthSuccess } = rateLimiter;
const logger = loadedLogger;
const emailLinkOrigin = loadedEmailLinkOrigin;

/** The request as `auth` (and the rate-limit pre-checks) leave it. */
type AuthRequest = Request & {
  user: { id: UserId; tenantId?: string | null; mustChangePassword?: boolean | null };
  sessionId?: string | null;
  session?: unknown;
  signInMethod?: string | null;
  mfaEnrolmentRequired?: boolean;
};

/** A thrown value, as the outcome recorder reads it. */
type Thrown = Parameters<typeof resolveErrorStatus>[0] & { message?: unknown };

/** A sign-in answer, as login() reads it. */
interface SignInResult {
  data?: unknown;
  token?: unknown;
  session?: Parameters<typeof login>[3];
  refreshToken?: unknown;
  message?: string;
  status?: number;
}

/** The body, as a JavaScript caller sends it (a plain object, or none). */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the body shape it reads; a view, not a check
const bodyOf = <T>(req: Request): T | undefined => req.body as T | undefined;

// ------------------------------------------------------------------
// A-67 — RATE-LIMIT OUTCOME
//
// authPreCheck (auth.route) refuses a locked-out caller and attaches
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
const withAuthOutcome = (
  endpoint: string,
  errorMap: Record<string, number>,
  handler: (req: Request, res: Response) => Promise<unknown>,
) => async (req: Request, res: Response): Promise<unknown> => {
  let result;
  try {
    result = await handler(req, res);
  } catch (error) {
    const status = resolveErrorStatus(error as Thrown, errorMap);
    if (status >= 400 && status < 500 && status !== 429) {
      await noteAuthFailure(req, endpoint);
      logger.warn("Authentication attempt failed", {
        endpoint,
        status,
        reason: (error as Thrown).message,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
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
const requestContext = (req: Request): { ipAddress: string | null; userAgent: string | null } => ({
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
  ipAddress: req.ip || null,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…] || null`
  userAgent: req.headers?.["user-agent"] || null,
});

// P10-12: registerUser no longer throws the two 409s ("already registered/used").
const REGISTER_ERRORS = {};
const LOGIN_ERRORS = {
  credentials: 401,
  verify: 403,
  suspended: 403,
  locked: 423,
};
const SEND_OTP_ERRORS = { wait: 429, verified: 403 };
const RESET_PASSWORD_ERRORS = {};

const register = asyncHandlerWithMapping(
  withAuthOutcome("register", REGISTER_ERRORS, async (req, res) => {
    // A-289 (ADR-100): never the request's Origin or Host — a forged Origin put
    // the attacker's domain in a genuine activation email. FRONTEND_URL, else
    // HOST_URL; in production an unset origin refuses (500) BEFORE the
    // account is created or anything is mailed.
    const origin = emailLinkOrigin();

    // P10-12 (A-290): one answer for a new address, a taken email and a taken
    // username — registerUser returns the same object for all three.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…]`
    const result = await authService.registerUser(req.body as Record<string, unknown>, origin, { ipAddress: req.ip ?? null, userAgent: req.headers?.["user-agent"] ?? null });

    success(res, null, null, result.message, result.status);
  }),
  REGISTER_ERRORS,
);

const activation = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    const { token } = req.query as { token?: string };
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

const loginHandler = asyncHandlerWithMapping(
  withAuthOutcome("login", LOGIN_ERRORS, async (req, res) => {
    const result = (await authService.loginUser({
      ...(req.body as Record<string, unknown>),
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    })) as SignInResult;

    login(res, result.data, result.token, result.session, { refreshToken: result.refreshToken });
  }),
  LOGIN_ERRORS,
);

const sendOTP = asyncHandlerWithMapping(
  withAuthOutcome("forgotPassword", SEND_OTP_ERRORS, async (req, res) => {
    await authService.requestOTP(req.body as Record<string, unknown>);

    success(res, null, null, "If the account exists, OTP has been sent", 200);
  }),
  SEND_OTP_ERRORS,
);

const resetPassword = asyncHandlerWithMapping(
  withAuthOutcome("resetPassword", RESET_PASSWORD_ERRORS, async (req, res) => {
    await authService.processResetPassword(req.body as Record<string, unknown>);

    success(res, null, null, "Password reset successful", 200);
  }),
  RESET_PASSWORD_ERRORS,
);

const logout = asyncHandlerWithMapping(async (_req: Request, res: Response) => {
  await authService.logoutSession();
  success(res, null, null, "Logout successful", 200);
}, {});

const logoutAll = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  await authService.logoutAllUserSessions((req as AuthRequest).user.id);
  success(res, null, null, "All sessions revoked successfully", 200);
}, {});

const verify = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    const r = req as AuthRequest;
    const result = await authService.verifyUserSession(
      r.user.id,
      r.session,
    );

    // A-160: "who am I" is one of the routes an account that must enrol MFA
    // may call, so this is where the frontend learns it (auth.middleware
    // decided it from the tenant's policy).
    // A-216: and whether the identity provider manages this session's
    // password — the change-password page then explains instead of asking.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty method reads as null
    const passwordManagedBy = await authService.passwordManagedBy(r.user, r.signInMethod || null);
    success(
      res,
      { ...(result["data"] as object), mfaEnrolmentRequired: r.mfaEnrolmentRequired === true, passwordManagedBy },
      null,
      result.message,
      result.status,
    );
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
// eslint-disable-next-line @typescript-eslint/require-await -- as built: an async handler, so its result is a promise the wrapper chains
const socketToken = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as AuthRequest;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: jwt.util is loaded when the handler runs
  const { generatePurposeToken } = require("../utils/jwt.util") as typeof JwtUtil;
  const expiresIn = 300; // seconds — shorter than JWT_ACCESS_EXPIRED on purpose
  // A-52 / A-59: a "socket" purpose token. It used to be jwt.sign()ed here with
  // no `typ`, which verifyAccessToken accepts — so this five-minute handshake
  // token was also a bearer access token. It now works ONLY at the socket
  // handshake (config/socket.js), and carries the caller's session (`sid`) so
  // the handshake refuses a revoked session.
  const token = generatePurposeToken(
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty session id reads as undefined
    { id: r.user.id, sid: r.sessionId || undefined },
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

const justUpdatePassword = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as AuthRequest;
  // `req.user` destructured as written in the `.js`, so a missing user throws the same message.
  const { id: userId } = req.user as AuthRequest["user"];
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { newPassword, currentPassword } = bodyOf<{ newPassword?: string; currentPassword?: string }>(req) || {};
  // A-98 / F-12: the audit row the service writes carries the caller's
  // address and user agent.
  // A-216: `signInMethod` (the session's `amr`, auth.middleware) — a
  // federated session is told its identity provider manages the password.
  const result = await authService.justUpdatePassword(
    userId,
    newPassword as string,
    currentPassword as string,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty method reads as null
    { ...requestContext(req), signInMethod: r.signInMethod || null },
  );
  success(res, null, null, result.message, 200);
}, {});

const passIsValid = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  // `req.user` destructured as written in the `.js`, so a missing user throws the same message.
  const { id: userId } = req.user as AuthRequest["user"];
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { password } = bodyOf<{ password?: unknown }>(req) || {};
  // A-260: under the signed-in password budget; a spent one is a 429 with
  // Retry-After (controllerWrapper sends the header).
  const result = await authService.passIsValid(userId, password, requestContext(req));
  success(res, result["data"], null, result.message, 200);
}, {});

// ------------------------------------------------------------------
// MFA (MULTI-FACTOR AUTHENTICATION)
// ------------------------------------------------------------------

// A-142: setup, verify and disable are rate-limited as one `mfaManage`
// bucket per user (mfaManagePreCheck, auth.route). A 4xx counts as a
// failed attempt and a success clears the count — `withAuthOutcome`, as on
// every other auth endpoint.

// A-114: on an account that already has MFA, setup is a ROTATION and needs
// `currentPassword` and a `code` from the current authenticator (409 without
// them). Both come from the body; the user is always the caller.
const setupMfa = asyncHandlerWithMapping(
  withAuthOutcome("mfaManage", {}, async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const { currentPassword, code } = bodyOf<{ currentPassword?: unknown; code?: unknown }>(req) || {};
    const result = await authService.setupMfa((req as AuthRequest).user.id, { currentPassword, code }, requestContext(req));
    success(res, result, null, "MFA secret generated", 200);
  }),
  {},
);

const MFA_VERIFY_ERRORS = { "Invalid MFA code": 400 };

// A-141: the response carries the new one-time recovery codes — the only
// time they are ever shown — at `data.recoveryCodes`. `sessionId` lets a
// rotation keep the caller's own session while every other one is revoked.
const verifyMfaSetup = asyncHandlerWithMapping(
  withAuthOutcome("mfaManage", MFA_VERIFY_ERRORS, async (req, res) => {
    const r = req as AuthRequest;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const { code } = bodyOf<{ code?: unknown }>(req) || {};
    if (!code) {
      throw new AppError(400, "MFA code is required");
    }
    const result = await authService.verifyMfaSetup(r.user.id, code, {
      ...requestContext(req),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty session id reads as null
      sessionId: r.sessionId || null,
    });
    success(res, { recoveryCodes: result["recoveryCodes"] }, null, result.message, 200);
  }),
  MFA_VERIFY_ERRORS,
);

// A-141: turn MFA off. Needs `currentPassword` and either `code` (TOTP) or
// `recoveryCode`; every other session of the caller is signed out.
const disableMfa = asyncHandlerWithMapping(
  withAuthOutcome("mfaManage", {}, async (req, res) => {
    const r = req as AuthRequest;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const { currentPassword, code, recoveryCode } = bodyOf<{ currentPassword?: unknown; code?: unknown; recoveryCode?: unknown }>(req) || {};
    const result = await authService.disableMfa(
      r.user.id,
      { currentPassword, code, recoveryCode },
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty session id reads as null
      { ...requestContext(req), sessionId: r.sessionId || null },
    );
    success(
      res,
      { otherSessionsRevoked: result["otherSessionsRevoked"] },
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

const loginMfa = asyncHandlerWithMapping(
  withAuthOutcome("mfaLogin", MFA_LOGIN_ERRORS, async (req, res) => {
    // A-141: `recoveryCode` is accepted in place of `code`.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const { code, token, recoveryCode } = bodyOf<{ code?: unknown; token?: string; recoveryCode?: unknown }>(req) || {};
    if ((!code && !recoveryCode) || !token) {
      throw new AppError(400, "MFA code and temporary token are required");
    }

    // Verify the temporary MFA token. A-59: only an "mfa" purpose token is
    // accepted here — an access token, an activation token or a socket token
    // is refused, and the mfa token is refused everywhere else.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: jwt.util is loaded when the handler runs
    const { verifyPurposeToken } = require("../utils/jwt.util") as typeof JwtUtil;
    let decoded;
    try {
      decoded = verifyPurposeToken(token, "mfa");
    } catch {
      throw new AppError(401, "Invalid or expired login token");
    }

    // As built: the claims are read off whatever verified (a string payload has neither).
    const claims = decoded as { mfaRequired?: unknown; id?: unknown };
    if (!claims.mfaRequired || !claims.id) {
      throw new AppError(401, "Invalid token payload");
    }

    const result = (await authService.loginMfa(
      claims.id as string,
      code,
      req.ip,
      req.headers["user-agent"],
      // A-288 (ADR-100): a device-reported location, for a tenant geofence.
      { recoveryCode, location: bodyOf<{ location?: unknown }>(req)?.location },
    )) as SignInResult;

    login(res, result.data, result.token, result.session, { refreshToken: result.refreshToken });
  }),
  MFA_LOGIN_ERRORS,
);

// ------------------------------------------------------------------
// IMPERSONATION
// ------------------------------------------------------------------

const impersonateUser = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { tenantId, userId } = bodyOf<{ tenantId?: string; userId?: string }>(req) || {};
  if (!tenantId || !userId) {
    throw new AppError(400, "tenantId and userId are required");
  }

  const result = (await authService.impersonateUser(
    (req as AuthRequest).user.id,
    tenantId,
    userId,
    req.ip,
    req.headers["user-agent"],
  )) as SignInResult;

  login(res, result.data, result.token, result.session, { refreshToken: result.refreshToken });
}, {
  "Only Super Admins can impersonate users": 403,
  "Target user not found in the specified tenant": 404,
  "Cannot impersonate yourself": 400,
});

const refresh = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { refreshToken, sessionId } = bodyOf<{ refreshToken?: string; sessionId?: string | null }>(req) || {};
  if (!refreshToken) {
    throw new AppError(400, "Refresh token is required");
  }
  const result = await authService.refreshUserToken(
    refreshToken,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty session id reads as null
    sessionId || null,
    req.ip,
    req.headers["user-agent"],
  );
  success(res, result["data"], null, result.message, 200);
}, {});

// NOTE: setupMfa / verifyMfaSetup / loginMfa were previously DEFINED A SECOND
// TIME here, silently overwriting the implementations above. The duplicate
// loginMfa was a stub that threw 501 "MFA login flow not fully implemented",
// so POST /api/v1/auth/mfa/login could never work and authService.loginMfa
// (which verifies the temp token and issues the session) was unreachable dead
// code. The duplicates have been removed; the authService-backed handlers
// above — the only complete set — are now the live ones.

// The key `login` is the handler; `login` the local name is response.util's.
const controller = {
  register,
  activation,
  login: loginHandler,
  sendOTP,
  resetPassword,
  logout,
  logoutAll,
  verify,
  socketToken,
  justUpdatePassword,
  passIsValid,
  setupMfa,
  verifyMfaSetup,
  disableMfa,
  loginMfa,
  impersonateUser,
  refresh,
};

export = controller;
