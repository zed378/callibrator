const { Tenants } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { deleteUpload, getUploadUrl } = require("../utils/upload.util");

// ==========================================
// TENANT LOGO UPLOAD SERVICE
// ==========================================

/**
 * Update tenant logo
 * @param {string} tenantId - Tenant identifier
 * @param {string} filename - Uploaded filename
 * @param {string} updatedBy - User ID who updated
 */
exports.updateTenantLogo = async (tenantId, filename, updatedBy) => {
  try {
    const tenant = await Tenants.findByPk(tenantId);

    if (!tenant) {
      throw new AppError(404, "Tenant not found");
    }

    // Delete old logo if exists and not default
    if (tenant.logo) {
      const oldFilename = tenant.logo.split("/").pop();
      if (oldFilename && oldFilename !== "default.svg") {
        try {
          await deleteUpload(oldFilename, "uploads/tenant");
        } catch (err) {
          logger.warn(`Failed to delete old logo: ${oldFilename}`, err);
        }
      }
    }

    // Update tenant with new logo (store only filename)
    await tenant.update({ logo: filename }, { silent: true });

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
 */
exports.removeTenantLogo = async (tenantId, updatedBy) => {
  try {
    const tenant = await Tenants.findByPk(tenantId);

    if (!tenant) {
      throw new AppError(404, "Tenant not found");
    }

    // Delete logo file if exists and not default
    if (tenant.logo) {
      const filename = tenant.logo.split("/").pop();
      if (filename && filename !== "default.svg") {
        try {
          await deleteUpload(filename, "uploads/tenant");
        } catch (err) {
          logger.warn(`Failed to delete logo file: ${filename}`, err);
        }
      }

      await tenant.update({ logo: null }, { silent: true });
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
