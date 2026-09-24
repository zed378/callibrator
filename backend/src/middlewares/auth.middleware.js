const { verifyAccessToken } = require("../utils/jwt.util");
const { unauthorized, forbidden, error: errorResponse } = require("../utils/response.util");
const { ROLE_NAMES } = require("../constants");
const authService = require("../services/auth.service");
const tenantService = require("../services/tenant.service");
const apiKeyService = require("../services/apiKey.service");
const sessionService = require("../services/session.service");
const { logger } = require("./activityLog.middleware");
const { tenantContextMiddleware } = require("./tenantContext.middleware");
const { runWithImpersonator } = require("../utils/auditActor.util");
const { isPlatformTenant } = require("../constants/platformTenant");
const { isActiveTenantStatus } = require("../constants/tenantStatus");
const {
  MFA_ENROLMENT_REQUIRED_CODE,
  mfaEnrolmentRequired,
} = require("../utils/mfaPolicy.util");

/**
 * A-59 — TODO: flip to `false` to refuse access tokens that name no session.
 *
 * Since A-59 every issuer of an access token sets `sid`: loginUser, loginMfa,
 * refreshUserToken, impersonateUser (auth.service.js) and both SSO callbacks
 * (sso.controller.js). The activation, MFA-pending and socket tokens are no
 * longer access tokens at all (jwt.util.js#generatePurposeToken). So a sid-less
 * access token can now only be one issued BEFORE that deploy — and it cannot be
 * revoked, it lasts until its own `exp` (JWT_ACCESS_EXPIRED, 1d deployed).
 *
 * It stays `true` because flipping it signs out every session issued before
 * the deploy. That is an announced change, not a quiet one: flip it once
 * JWT_ACCESS_EXPIRED has elapsed since the deploy (after which no sid-less
 * token can still be unexpired, and flipping it costs nobody anything).
 */
const SIDLESS_ACCESS_TOKENS_ACCEPTED = true;

exports.SIDLESS_ACCESS_TOKENS_ACCEPTED = SIDLESS_ACCESS_TOKENS_ACCEPTED;

/**
 * Whether a loaded principal is the platform super admin. The role name has
 * been spelled three ways over time; all three are the super admin.
 *
 * @param {{role?: {name?: string}|null}} user
 * @returns {boolean}
 */
const isSuperAdminPrincipal = (user) =>
  user.role?.name === ROLE_NAMES.SUPER_ADMIN ||
  user.role?.name === "SUPER_ADMIN" ||
  user.role?.name === "SUPERADMIN";

/**
 * A-101 — why this principal's tenant may not act, or null when it may. The
 * same rule as the sign-in points (auth.service.js `tenantRefusal`, A-83),
 * kept here rather than imported because most suites replace auth.service
 * with a double that has only the loader.
 *
 * A user whose tenantId names no tenant the include can see is refused as
 * deleted: getAuthUserWithTenant loads the tenant through the Tenant model's
 * default scope (isDeleted = false) and paranoid, so a soft-deleted or
 * destroyed tenant comes back as `tenant: null`. This used to let the request
 * through — only a VISIBLE suspended/deleted tenant was refused — so a
 * soft-deleted tenant's users kept working on any unexpired session although
 * none of them could sign in again.
 *
 * A principal with no tenantId (a platform super admin need not have one) is
 * never refused here. A super admin whose home tenant is gone is refused like
 * anyone else — as sign-in already refuses them; tenant.service deleteTenant
 * refuses a tenant that still has users, which is what keeps the default
 * tenant (home of the seeded super admin) from being deleted under them.
 *
 * @param {{tenantId?: string|null, tenant?: {status?: string}|null}} user
 * @returns {string|null} the refusal message (answered with 403)
 */
const tenantRefusal = (user) => {
  if (!user.tenantId) {
    return null;
  }
  // A-125 follow-up: the reserved PLATFORM tenant is not a customer and is
  // nobody's workplace but the operator's. A non-super-admin account whose
  // home is PLATFORM (it can only get there by a direct database write or a
  // bug upstream) is refused outright — otherwise it would act inside the
  // tenant that holds the platform audit trail. The Tenant model's
  // excludePlatformTenant hook does NOT cover the include that loads
  // `user.tenant`, so the tenant row alone would have let it through.
  if (isPlatformTenant(user.tenantId) && !isSuperAdminPrincipal(user)) {
    return "Tenant account is not available";
  }
  if (!user.tenant) {
    return "Tenant account is deleted";
  }
  const status = String(user.tenant.status || "").toLowerCase();
  return status === "suspended" || status === "deleted"
    ? `Tenant account is ${status}`
    : null;
};

/**
 * F-8 — the impersonating super admin named by a VERIFIED access token, or
 * null. Only impersonateUser (auth.service.js) sets the claim, and only a
 * non-empty string is taken: the value is written into audit_logs, so anything
 * else is ignored rather than trusted. Never read from a body, header or query.
 *
 * @param {object} decoded - verified access-token payload
 * @returns {string|null}
 */
/**
 * A-123 (ADR-051 Q-11) — the routes an account flagged `mustChangePassword`
 * may still call: change the password, sign out, and "who am I" (which is how
 * the frontend learns about the flag). Every other authenticated route
 * answers 403 PASSWORD_CHANGE_REQUIRED until the password is changed.
 *
 * Matched on method + the FULL path (router mount + route), so a same-named
 * route under another router is not let through.
 */
const PASSWORD_CHANGE_ALLOWED = new Set([
  "POST /api/v1/auth/just-update-password",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/logout-all",
  "POST /api/v1/auth/verify",
]);

exports.PASSWORD_CHANGE_ALLOWED = PASSWORD_CHANGE_ALLOWED;
exports.PASSWORD_CHANGE_REQUIRED_CODE = "PASSWORD_CHANGE_REQUIRED";

/**
 * A-160 — the routes an account that must enrol MFA (the tenant's "MFA
 * required" policy, utils/mfaPolicy.util.js) may still call: start and
 * confirm an enrolment, sign out, "who am I" (which is how the frontend
 * learns about it), and change password — an account can be under A-123's
 * forced change AND this policy at once, and the password gate runs first,
 * so without it neither gate could ever be cleared.
 *
 * Matched on method + the FULL path, as PASSWORD_CHANGE_ALLOWED is.
 */
const MFA_ENROLMENT_ALLOWED = new Set([
  "POST /api/v1/auth/mfa/setup",
  "POST /api/v1/auth/mfa/verify",
  "POST /api/v1/auth/just-update-password",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/logout-all",
  "POST /api/v1/auth/verify",
]);

exports.MFA_ENROLMENT_ALLOWED = MFA_ENROLMENT_ALLOWED;
exports.MFA_ENROLMENT_REQUIRED_CODE = MFA_ENROLMENT_REQUIRED_CODE;

/**
 * Whether an account that must enrol MFA is refused on this request.
 *
 * @param {object} user - req.user
 * @param {object} req
 * @param {string|null} impersonatorId
 * @returns {boolean}
 */
const mustEnrolMfaFirst = (user, req, impersonatorId) =>
  mfaEnrolmentRequired(user, impersonatorId) &&
  !MFA_ENROLMENT_ALLOWED.has(`${req.method} ${req.baseUrl || ""}${req.path || ""}`);

/**
 * Whether a flagged account must be refused on this request.
 *
 * An impersonation token is not refused: the impersonating super admin is
 * not the account holder, cannot change the holder's password, and the
 * forced change protects the holder's credential, not the support session.
 *
 * @param {object} user - req.user
 * @param {object} req
 * @param {string|null} impersonatorId
 * @returns {boolean}
 */
const mustChangePasswordFirst = (user, req, impersonatorId) =>
  Boolean(user.mustChangePassword) &&
  !impersonatorId &&
  !PASSWORD_CHANGE_ALLOWED.has(`${req.method} ${req.baseUrl || ""}${req.path || ""}`);

const impersonatorFrom = (decoded) =>
  typeof decoded.impersonatorId === "string" && decoded.impersonatorId
    ? decoded.impersonatorId
    : null;

/**
 * A-48. Whether the session a verified access token was issued with is still
 * live. A token with no `sid` predates the claim and cannot be tied to a
 * session; see SIDLESS_ACCESS_TOKENS_ACCEPTED.
 *
 * @param {object} decoded - verified access-token payload
 * @returns {Promise<boolean>}
 */
const sessionIsUsable = async (decoded) =>
  decoded.sid
    ? sessionService.isSessionLive(decoded.sid, decoded.id)
    : SIDLESS_ACCESS_TOKENS_ACCEPTED;

// Resolve an `Authorization: ApiKey <key>` header to a synthetic, scoped
// service-account principal. Returns true if it handled the request (called
// next or sent a response), false if the header isn't an API key.
const tryApiKeyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("ApiKey ")) {
    return false;
  }
  const rawKey = authHeader.slice("ApiKey ".length).trim();
  const key = await apiKeyService.verifyApiKey(rawKey);
  if (!key) {
    unauthorized(res, "Invalid or expired API key");
    return true;
  }
  const tenantStatus = key.tenant && String(key.tenant.status || "").toLowerCase();
  if (tenantStatus === "suspended" || tenantStatus === "deleted") {
    forbidden(res, `Tenant account is ${tenantStatus}`);
    return true;
  }
  // Synthetic principal — carries a non-privileged role name so downstream
  // authorization takes the API-key (scope) path, never the role matrix.
  req.user = {
    id: key.id,
    tenantId: key.tenantId,
    isApiKey: true,
    apiKeyScopes: Array.isArray(key.scopes) ? key.scopes : [],
    role: { id: null, name: "API_KEY" },
    tenant: key.tenant,
  };
  req.tenantId = key.tenantId;
  req.tenant = key.tenant;
  tenantContextMiddleware(req, res, next);
  return true;
};

/**
 * Authentication Middleware
 * Validates JWT token, checks user status and session
 * Attaches tenant context when available
 */
exports.auth = async (req, res, next) => {
  try {
    // ==========================================
    // API KEY AUTH (Authorization: ApiKey <key>)
    // ==========================================
    if (await tryApiKeyAuth(req, res, next)) {
      return;
    }

    // ==========================================
    // TOKEN EXTRACTION
    // ==========================================

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return unauthorized(res, "Unauthorized");
    }

    const token = authHeader.split(" ")[1];

    // ==========================================
    // VERIFY JWT
    // ==========================================

    const decoded = verifyAccessToken(token);

    // ==========================================
    // MFA-PENDING TOKEN IS NOT AN ACCESS TOKEN
    // ==========================================
    // When an MFA-enabled account passes the first factor, loginUser issues a
    // short-lived token carrying `mfaRequired: true`. That token is ONLY valid
    // for exchange at POST /auth/mfa/login after the second factor — it must
    // never grant access to protected resources. Reject it here.
    //
    // Since A-59 that token is typ "mfa", which verifyAccessToken above already
    // refuses; this check remains for one minted as an access token before
    // that deploy (they live five minutes).
    if (decoded.mfaRequired) {
      return unauthorized(res, "MFA verification required");
    }

    // ==========================================
    // SESSION STILL LIVE (A-48)
    // ==========================================
    // Revoking a session (logout, an administrator's revoke, a password
    // change, refresh-token rotation) must stop the access token issued with
    // it on the next request, not when the token expires. Cached in Redis;
    // see session.service.js#isSessionLive for the Redis-down behaviour.
    if (!(await sessionIsUsable(decoded))) {
      return unauthorized(res, "Session has been revoked or has expired");
    }

    // ==========================================
    // FETCH USER WITH ROLE AND TENANT
    // ==========================================

    const user = await authService.getAuthUserWithTenant(decoded.id);

    if (!user) {
      return unauthorized(res, "User not found");
    }

    // ==========================================
    // CHECK USER STATUS
    // ==========================================

    if (!user.isActive) {
      return forbidden(res, "Account banned");
    }

    // A-180: "erased" — a GDPR-anonymised account (gdpr.service).
    if (user.status === "INACTIVE" || user.status === "SUSPENDED" || user.status === "erased") {
      return forbidden(res, `Account is ${user.status.toLowerCase()}`);
    }

    // ==========================================
    // FORCED PASSWORD CHANGE (A-123, ADR-051 Q-11)
    // ==========================================
    // An administrator chose this account's password, and a password signs
    // (ADR-047). Until the holder replaces it, only change-password, logout
    // and "who am I" are answered; the frontend redirects on this code.
    if (mustChangePasswordFirst(user, req, impersonatorFrom(decoded))) {
      return errorResponse(
        res,
        "You must change the password an administrator set for you before continuing",
        403,
        null,
        { code: exports.PASSWORD_CHANGE_REQUIRED_CODE },
      );
    }

    // ==========================================
    // TENANT "MFA REQUIRED" POLICY (A-160)
    // ==========================================
    // The user's tenant requires MFA and this account has none. Until it
    // enrols, only the enrolment routes, change-password, logout and "who am
    // I" are answered; the frontend sends it to the MFA page on this code.
    const impersonatorId = impersonatorFrom(decoded);
    if (mustEnrolMfaFirst(user, req, impersonatorId)) {
      return errorResponse(
        res,
        "Your organisation requires multi-factor authentication. Set it up before continuing",
        403,
        null,
        { code: MFA_ENROLMENT_REQUIRED_CODE },
      );
    }

    // ==========================================
    // ATTACH USER TO REQUEST
    // ==========================================

    req.user = user;
    // A-160: /auth/verify reports it, so the frontend can go to the MFA page
    // before a request is refused.
    req.mfaEnrolmentRequired = mfaEnrolmentRequired(user, impersonatorId);
    req.token = token;
    req.sessionId = decoded.sid || null;
    // F-8: the super admin acting through this token, when it is an
    // impersonation token. Every audit row the request writes names them.
    req.impersonatorId = impersonatorId;

    // Attach tenant context from user
    if (user.tenantId) {
      const refusal = tenantRefusal(user);
      if (refusal) {
        return forbidden(res, refusal);
      }
      req.tenantId = user.tenantId;
      req.tenant = user.tenant;
    }

    // Only allow explicit tenant header overrides if user is SUPER_ADMIN.
    // Tenant-bound and tenant-less non-super-admin accounts must NEVER be able
    // to select a tenant via request headers — doing so would let any
    // authenticated user operate inside an attacker-chosen tenant.
    if (isSuperAdminPrincipal(user)) {
      const tenantCode = req.headers["x-tenant-code"];
      const tenantIdHeader = req.headers["x-tenant-id"];

      if (tenantCode) {
        const tenant =
          await tenantService.getTenantByCodeForMiddleware(tenantCode);
        if (tenant) {
          req.tenant = tenant;
          req.tenantId = tenant.id;
        }
      }

      if (tenantIdHeader) {
        const tenant =
          await tenantService.getTenantByIdForMiddleware(tenantIdHeader);
        // A-143: `tenants.status` is a lower-case ENUM; comparing it with
        // "ACTIVE" never matched, so this override never applied.
        if (tenant && isActiveTenantStatus(tenant.status)) {
          req.tenant = tenant;
          req.tenantId = tenant.id;
        }
      }
    }

    // The session is carried in a request context as well as on req, because
    // POST /auth/logout reaches authService.logoutSession() without `req`.
    sessionService.runWithSession(req.sessionId, () =>
      runWithImpersonator(req.impersonatorId, () =>
        tenantContextMiddleware(req, res, next),
      ),
    );
  } catch (error) {
    logger.error(`AUTH MIDDLEWARE ERROR: ${error.message}`, error.stack);
    return unauthorized(res, "Invalid token");
  }
};

/**
 * Optional auth middleware
 * Doesn't fail if no token is provided
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    // A revoked session's token is treated as no token at all.
    const user = (await sessionIsUsable(decoded))
      ? await authService.getAuthUserWithTenant(decoded.id)
      : null;

    // A-101: a principal whose tenant is suspended or gone is treated as no
    // principal at all — optional auth never refuses, it just does not attach.
    // A-123: nor does it attach an account that must change its password
    // first (unless impersonated) — it is anonymous until it has. A-160: nor
    // one that must enrol MFA first.
    if (
      user &&
      user.isActive &&
      (user.status === "ACTIVE" || user.status === "INACTIVE") &&
      !tenantRefusal(user) &&
      !mustChangePasswordFirst(user, req, impersonatorFrom(decoded)) &&
      !mustEnrolMfaFirst(user, req, impersonatorFrom(decoded))
    ) {
      req.user = user;
      req.impersonatorId = impersonatorFrom(decoded);
      if (user.tenantId) {
        req.tenantId = user.tenantId;
      }
    }

    runWithImpersonator(req.impersonatorId, () =>
      tenantContextMiddleware(req, res, next),
    );
  } catch (error) {
    // Continue without auth
    tenantContextMiddleware(req, res, next);
  }
};

/**
 * Reject API-key principals. Apply to sensitive endpoints (e.g. managing API
 * keys themselves) so a scoped service account cannot escalate privileges.
 */
exports.denyApiKey = (req, res, next) => {
  if (req.user && req.user.isApiKey) {
    return forbidden(res, "API keys cannot access this endpoint");
  }
  next();
};

// A-03. An API key is a scoped credential, but only `dynamicAccess` ever read
// its scopes — on a route without one the key was simply "an authenticated
// principal" and got everything the handler offered. Authorization for API
// keys is therefore deny-by-default: a gate that has actually authorized the
// key sets `req.apiKeyAuthorized`, and a key that reaches a controller without
// it is refused (see utils/controllerWrapper.util.js).
//
// This middleware is the explicit opt-in, for the few endpoints that are meant
// for service accounts and authorize them some other way (SCIM, which requires
// an API key and checks the target separately).
exports.allowApiKey = (req, res, next) => {
  req.apiKeyAuthorized = true;
  next();
};

/**
 * Super admin only middleware
 */
exports.superAdminOnly = (req, res, next) => {
  if (
    !req.user ||
    !req.user.role ||
    req.user.role.name !== ROLE_NAMES.SUPER_ADMIN
  ) {
    return forbidden(res, "Super admin access required");
  }
  next();
};
