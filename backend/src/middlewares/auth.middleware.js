const { verifyAccessToken } = require("../utils/jwt.util");
const { unauthorized, forbidden } = require("../utils/response.util");
const { ROLE_NAMES } = require("../constants");
const authService = require("../services/auth.service");
const tenantService = require("../services/tenant.service");
const apiKeyService = require("../services/apiKey.service");
const { logger } = require("./activityLog.middleware");
const { tenantContextMiddleware } = require("./tenantContext.middleware");

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
    if (decoded.mfaRequired) {
      return unauthorized(res, "MFA verification required");
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
    // ATTACH USER TO REQUEST (RBAC Only - No Session Validation)
    // ==========================================

    req.user = user;
    req.token = token;

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

    tenantContextMiddleware(req, res, next);
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

    const user = await authService.getAuthUserWithTenant(decoded.id);

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
