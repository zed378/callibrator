const { Tenants } = require("../models");
const { db } = require("../config");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { deleteUpload } = require("../utils/upload.util");
const auditService = require("./audit.service");

// ==========================================
// TENANT LOGO UPLOAD SERVICE
// ==========================================

/** The "no logo" sentinel — never a file of this tenant's to delete. */
const LOGO_PLACEHOLDER = "default.svg";
const LOGO_FOLDER = "uploads/public/tenant";

/**
 * The stored logo filename of a tenant, or null when it has none of its own.
 *
 * @param {object} tenant
 * @returns {string|null}
 */
const ownLogoFile = (tenant) => {
  const stored = tenant.logo ? String(tenant.logo).split("/").pop() : null;
  return stored && stored !== LOGO_PLACEHOLDER ? stored : null;
};

/**
 * A-96. Change a tenant's `logo`: the row update and its audit row share ONE
 * transaction (CLAUDE.md, A-41), and the file the change stops referencing is
 * deleted only AFTER the commit. It used to be deleted first, so a failed
 * update left the tenant pointing at a file that no longer existed.
 *
 * `actor` defaults to "nobody": a non-super-admin may change only their own
 * tenant; any other id is 404 "Tenant not found", like a missing one
 * (`tenants` is not tenant-scoped, so findByPk alone would load anyone's). On
 * the HTTP path checkTenant has already refused that at the gate; this is the
 * service holding its own line, as updateTenant does (A-63).
 *
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string|null} p.next - the new logo value
 * @param {string} p.operation - changes.operation for the audit row
 * @param {string|null} p.updatedBy - the acting user id (from req.user)
 * @param {{actorIsSuperAdmin?: boolean, tenantId?: (string|null),
 *   ipAddress?: (string|null), userAgent?: (string|null)}} p.actor
 * @param {boolean} p.skipWhenNoLogo - a remove with nothing to remove writes nothing
 * @returns {Promise<{changed: boolean}>}
 */
const changeLogo = async ({ tenantId, next, operation, updatedBy, actor, skipWhenNoLogo }) => {
  const transaction = await db.transaction();
  let replaced;
  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    const foreign =
      Boolean(tenant) &&
      actor.actorIsSuperAdmin !== true &&
      String(tenant.id) !== String(actor.tenantId);
    if (!tenant || foreign) {
      if (foreign) {
        logger.warn("tenantUpload.service: cross-tenant logo change refused", {
          reason: "cross-tenant",
          tenantId: String(tenantId),
          actorTenantId: String(actor.tenantId),
          operation,
        });
      }
      throw new AppError(404, "Tenant not found");
    }

    replaced = ownLogoFile(tenant);
    if (skipWhenNoLogo && !replaced) {
      // Nothing to change, so nothing to audit.
      await transaction.rollback();
      return { changed: false };
    }

    const before = tenant.logo ?? null;
    // Store only the filename.
    await tenant.update({ logo: next }, { silent: true, transaction });

    await auditService.logAction(
      {
        tenantId: tenant.id,
        userId: updatedBy || null,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: tenant.id,
        changes: { operation, logo: { before, after: next } },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    // Every throw above happens before the commit.
    await transaction.rollback().catch(() => {});
    throw error;
  }

  // Never the file just stored (a re-upload under the same name).
  if (replaced && replaced !== next) {
    try {
      await deleteUpload(replaced, LOGO_FOLDER);
    } catch (err) {
      // The change is committed; a leftover file is a storage leak, not a
      // reason to report it as failed.
      logger.warn(`Failed to delete replaced logo: ${replaced}`, err);
    }
  }
  return { changed: true };
};

/**
 * Update tenant logo
 * @param {string} tenantId - Tenant identifier
 * @param {string} filename - Uploaded filename
 * @param {string} updatedBy - User ID who updated
 * @param {object} [actor] - see changeLogo; defaults to nobody
 */
exports.updateTenantLogo = async (tenantId, filename, updatedBy, actor = {}) => {
  try {
    await changeLogo({
      tenantId,
      next: filename,
      operation: "UPDATE_LOGO",
      updatedBy,
      actor,
      skipWhenNoLogo: false,
    });

    logger.info(`Tenant logo updated: ${tenantId} by ${updatedBy}`);

    return {
      data: { logo: filename },
      message: "Tenant logo updated successfully",
      status: 200,
    };
  } catch (error) {
    if (error instanceof AppError) {throw error;}
    logger.error("Error updating tenant logo", { error: error.message });
    throw new AppError(500, "Failed to update tenant logo");
  }
};

/**
 * Remove tenant logo
 * @param {string} tenantId - Tenant identifier
 * @param {string} updatedBy - User ID who updated
 * @param {object} [actor] - see changeLogo; defaults to nobody
 */
exports.removeTenantLogo = async (tenantId, updatedBy, actor = {}) => {
  try {
    const { changed } = await changeLogo({
      tenantId,
      next: null,
      operation: "REMOVE_LOGO",
      updatedBy,
      actor,
      skipWhenNoLogo: true,
    });

    if (changed) {
      logger.info(`Tenant logo removed: ${tenantId} by ${updatedBy}`);
    }

    return {
      data: { logo: null },
      message: "Tenant logo removed successfully",
      status: 200,
    };
  } catch (error) {
    if (error instanceof AppError) {throw error;}
    logger.error("Error removing tenant logo", { error: error.message });
    throw new AppError(500, "Failed to remove tenant logo");
  }
};
