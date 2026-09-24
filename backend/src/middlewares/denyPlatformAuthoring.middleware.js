const { forbidden } = require("../utils/response.util");
const { tenantStorage } = require("./tenantContext.middleware");
const { currentImpersonatorId } = require("../utils/auditActor.util");

/**
 * A-127 (ADR-051 Q-17) — platform operators may not author Part 11 records
 * inside a tenant.
 *
 * A Part 11 act — signing, approving, submitting or revoking a certificate,
 * e-signing a document, creating, editing or deleting a calibration record —
 * must be attributable to a member of the tenant whose record it is. Two ways
 * a platform operator reaches a tenant are refused here with 403:
 *
 *  1. IMPERSONATION. The access token carries `impersonatorId` (auth
 *     middleware → `req.impersonatorId`, and the request's impersonation
 *     context). The record would name the hospital user while a super admin
 *     authored it.
 *  2. TENANT OVERRIDE. A super admin whose effective tenant (`req.tenantId`,
 *     set from `x-tenant-id` / `x-tenant-code`) is not their home tenant — or
 *     who has no home tenant at all, and so is a member of none.
 *
 * A super admin acting in their OWN home tenant with no override is a member
 * of that tenant and is let through — but with the tenant context REBOUND to
 * that home tenant as an ordinary member. Otherwise the super-admin context
 * (utils/tenantScope.util.js, `isSuperAdmin -> skip`) would let them sign or
 * approve another tenant's record by id with no header at all, which is the
 * same act this middleware exists to refuse. Rebound, another tenant's record
 * is simply not found (404), as for any member.
 *
 * Every other write stays allowed to an operator and is audited with the
 * impersonator (F-8). Mount this AFTER `auth` (it reads `req.user`,
 * `req.tenantId`, `req.impersonatorId`). The routes that carry it are
 * enumerated by tests/routes/denyPlatformAuthoring.a127.test.js, so a new
 * Part 11 route cannot be added without someone deciding about it.
 */

const SUPER_ADMIN_NAMES = new Set(["SUPERADMIN", "SUPER_ADMIN"]);

const IMPERSONATING =
  "This is a 21 CFR Part 11 record and cannot be authored while impersonating a user " +
  "(ADR-051 Q-17). A member of the hospital must perform this action under their own account.";

const OTHER_TENANT =
  "This is a 21 CFR Part 11 record and a platform operator cannot author it inside another " +
  "tenant (ADR-051 Q-17). A member of that tenant must perform this action under their own account.";

const NO_TENANT =
  "This is a 21 CFR Part 11 record and a platform operator who is not a member of any tenant " +
  "cannot author it (ADR-051 Q-17). A member of the tenant must perform this action.";

/**
 * @param {import("express").Request} req
 * @returns {boolean}
 */
const isSuperAdmin = (req) =>
  Boolean(req.user && req.user.role && SUPER_ADMIN_NAMES.has(req.user.role.name));

/**
 * Why a platform operator may not author a Part 11 record on this request, or
 * null when the principal may.
 *
 * @param {import("express").Request} req
 * @returns {string|null}
 */
const platformAuthoringRefusal = (req) => {
  if (req.impersonatorId || currentImpersonatorId()) {
    return IMPERSONATING;
  }
  if (!isSuperAdmin(req)) {
    return null;
  }
  if (!req.user.tenantId) {
    return NO_TENANT;
  }
  if (req.tenantId && req.tenantId !== req.user.tenantId) {
    return OTHER_TENANT;
  }
  return null;
};

/**
 * Express middleware; see the module comment.
 *
 * @type {import("express").RequestHandler}
 */
const denyPlatformAuthoring = (req, res, next) => {
  const refusal = platformAuthoringRefusal(req);
  if (refusal) {
    return forbidden(res, refusal);
  }
  if (isSuperAdmin(req)) {
    // Act as a member of the home tenant, never as the cross-tenant operator.
    return tenantStorage.run(
      { tenantId: req.user.tenantId, isSuperAdmin: false, isSystemTask: false },
      () => next(),
    );
  }
  return next();
};

module.exports = {
  denyPlatformAuthoring,
  platformAuthoringRefusal,
  MESSAGES: { IMPERSONATING, OTHER_TENANT, NO_TENANT },
};
