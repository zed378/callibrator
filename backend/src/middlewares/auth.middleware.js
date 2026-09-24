const { verifyAccessToken } = require("../utils/jwt.util");
const { unauthorized, forbidden } = require("../utils/response.util");
const { ROLE_NAMES } = require("../constants");
const authService = require("../services/auth.service");
const tenantService = require("../services/tenant.service");
const apiKeyService = require("../services/apiKey.service");
const sessionService = require("../services/session.service");
const { logger } = require("./activityLog.middleware");
const { tenantContextMiddleware } = require("./tenantContext.middleware");

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

    if (user.status === "INACTIVE" || user.status === "SUSPENDED") {
      return forbidden(res, `Account is ${user.status.toLowerCase()}`);
    }

    // ==========================================
    // ATTACH USER TO REQUEST
    // ==========================================

    req.user = user;
    req.token = token;
    req.sessionId = decoded.sid || null;

    // Attach tenant context from user
    if (user.tenantId) {
      if (
        user.tenant &&
        (user.tenant.status === "suspended" ||
          user.tenant.status === "deleted" ||
          user.tenant.status === "SUSPENDED" ||
          user.tenant.status === "DELETED")
      ) {
        return forbidden(
          res,
          `Tenant account is ${user.tenant.status.toLowerCase()}`,
        );
      }
      req.tenantId = user.tenantId;
      req.tenant = user.tenant;
    }

    // Only allow explicit tenant header overrides if user is SUPER_ADMIN.
    // Tenant-bound and tenant-less non-super-admin accounts must NEVER be able
    // to select a tenant via request headers — doing so would let any
    // authenticated user operate inside an attacker-chosen tenant.
    const isSuperAdmin =
      user.role?.name === ROLE_NAMES.SUPER_ADMIN ||
      user.role?.name === "SUPER_ADMIN" ||
      user.role?.name === "SUPERADMIN";

    if (isSuperAdmin) {
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
        if (tenant && tenant.status === "ACTIVE") {
          req.tenant = tenant;
          req.tenantId = tenant.id;
        }
      }
    }

    // The session is carried in a request context as well as on req, because
    // POST /auth/logout reaches authService.logoutSession() without `req`.
    sessionService.runWithSession(req.sessionId, () =>
      tenantContextMiddleware(req, res, next),
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

    if (
      user &&
      user.isActive &&
      (user.status === "ACTIVE" || user.status === "INACTIVE")
    ) {
      req.user = user;
      if (user.tenantId) {
        req.tenantId = user.tenantId;
      }
    }

    tenantContextMiddleware(req, res, next);
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
