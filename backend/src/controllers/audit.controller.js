const auditService = require("../services/audit.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { AppError } = require("../utils/appError.util");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");
const { ACTOR_TYPE_VALUES } = require("../constants/systemActors");

/** The one value `scope` takes: the PLATFORM tenant's trail (A-125). */
const PLATFORM_SCOPE = "platform";

/**
 * @param {import("express").Request} req
 * @returns {boolean} whether the authenticated principal is a super admin
 */
const isSuperAdmin = (req) => {
  const roleName = req.user && req.user.role && req.user.role.name;
  return roleName === "SUPER_ADMIN" || roleName === "SUPERADMIN";
};

/**
 * The tenant whose trail is read.
 *
 * The reader's HOME tenant, from the authenticated user only. `scope=platform`
 * reads the PLATFORM tenant's trail instead — platform operations (tenant
 * create and delete, global roles; ADR-051 Q-14) — and only a super admin may
 * ask for it. Anyone else asking is refused with 403: it is a permission
 * failure inside the caller's own tenant, and the PLATFORM tenant's existence
 * is no secret. For anyone but a super admin the tenant hooks would force the
 * caller's own tenant anyway; the 403 says so instead of answering with rows
 * the caller did not ask for.
 *
 * @param {import("express").Request} req
 * @returns {string|null}
 */
const readableTenantId = (req) => {
  const { scope } = req.query;
  if (scope === undefined || scope === "") {
    return req.user.tenantId;
  }
  if (scope !== PLATFORM_SCOPE) {
    throw new AppError(400, `Unknown audit scope "${scope}" — the only scope is "${PLATFORM_SCOPE}"`);
  }
  if (!isSuperAdmin(req)) {
    throw new AppError(403, "Only a platform administrator can read the platform audit trail");
  }
  return PLATFORM_TENANT_ID;
};

exports.fetchAuditLogs = asyncHandler(async (req, res) => {
  const tenantId = readableTenantId(req);
  const { page, limit, userId, actorType, action, resourceType, resourceId, startDate, endDate } =
    req.query;

  // An out-of-ENUM value would reach PostgreSQL as an invalid enum literal (500).
  if (actorType && !ACTOR_TYPE_VALUES.includes(actorType)) {
    throw new AppError(400, `actorType must be one of ${ACTOR_TYPE_VALUES.join(", ")}`);
  }

  const result = await auditService.fetchAuditLogs({
    tenantId,
    page,
    limit,
    userId,
    actorType,
    action,
    resourceType,
    resourceId,
    startDate,
    endDate,
  });

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});
