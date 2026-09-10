// src/middlewares/enforceQuota.js
//
// Express middleware that enforces tenant plan quotas and feature gating.
// Super admins bypass all quota checks (administrative override).

const quotaService = require("../services/quota.service");
const { AppError } = require("../utils/appError.util");

const isSuperAdmin = (req) => {
  const name = req.user?.role?.name;
  return name === "SUPER_ADMIN" || name === "SUPERADMIN";
};

/**
 * Block user creation once the tenant's seat limit is reached.
 * Enforced against the actor's own tenant (non-super-admins are locked to it).
 */
const enforceSeatQuota = () => async (req, res, next) => {
  try {
    if (isSuperAdmin(req)) {
      return next();
    }
    const tenantId = req.user?.tenantId;
    const status = await quotaService.checkSeatQuota(tenantId);
    if (!status.allowed) {
      throw new AppError(
        403,
        `Seat limit reached (${status.used}/${status.limit}). Upgrade your plan or remove a user to add more.`,
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Block uploads that would exceed the tenant's storage limit. Uses the request
 * Content-Length so it can reject BEFORE the file is written to disk; place it
 * ahead of the multer/upload middleware. Active now that the Attachment registry
 * makes storage usage measurable.
 */
const enforceStorageQuota = () => async (req, res, next) => {
  try {
    if (isSuperAdmin(req)) {
      return next();
    }
    const tenantId = req.user?.tenantId;
    const incomingBytes = Number(req.headers["content-length"]) || 0;
    const status = await quotaService.checkStorageQuota(tenantId, incomingBytes);
    if (!status.allowed) {
      throw new AppError(
        413,
        `Storage limit reached (${Math.round(status.usedMb)}MB of ${status.limitMb}MB used). Upgrade your plan or free up space.`,
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Gate a route behind a plan feature (see PLAN_FEATURES in quota.service).
 * Returns 402 Payment Required when the tenant's plan lacks the feature.
 */
const requireFeature = (feature) => async (req, res, next) => {
  try {
    if (isSuperAdmin(req)) {
      return next();
    }
    const tenantId = req.user?.tenantId;
    const { allowed, plan } = await quotaService.checkFeature(tenantId, feature);
    if (!allowed) {
      throw new AppError(
        402,
        `The "${feature}" feature is not available on the "${plan}" plan. Please upgrade to continue.`,
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { enforceSeatQuota, enforceStorageQuota, requireFeature };
