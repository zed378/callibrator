const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const moment = require("moment");

// Simplified tenant backup service - removed deprecated models (TenantSettings, TenantRoles, TenantFeatures, TenantAuditLog, UserPermissions)
const { TenantBackup, Tenant, Users } = require("../models");
// Sequelize helpers come from the package directly (not the models barrel) so
// they are available even when `../models` is mocked in unit tests.
const Sequelize = require("sequelize");
const { Op } = Sequelize;
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError, InternalServerError } = require("../utils/appError.util");
const storagePath = require("../utils/storagePath.util");

/**
 * Backup storage directory
 */
const BACKUP_DIR = storagePath("backup", "tenant-backups");

/**
 * Ensure backup directory exists
 * Returns true if directory exists or was created successfully
 */
function ensureBackupDirExists() {
  if (!fs.existsSync(BACKUP_DIR)) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        return false;
      }
      return true;
    }
  }
  return true;
}

/**
 * Generate a unique backup filename
 */
function generateBackupFilename(tenantId, backupId) {
  const timestamp = moment().format("YYYYMMDD_HHmmss");
  return `tenant_${tenantId}_${backupId}_${timestamp}.zip`;
}

/**
 * Calculate file checksum
 */
async function calculateChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Export tenant data to JSON structure (simplified)
 */
async function exportTenantData(tenantId, backupType, models) {
  const data = {
    metadata: {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      exportedBy: null,
      tenantId,
      backupType,
      applicationVersion: process.env.npm_package_version || "1.0.0",
    },
    tenant: null,
    users: [],
  };

  // Export tenant data
  const tenant = await Tenant.findByPk(tenantId);
  if (tenant) {
    data.tenant = tenant.toJSON();
  }

  if (
    backupType === TenantBackup.BACKUP_TYPES.FULL ||
    backupType === TenantBackup.BACKUP_TYPES.USER_ONLY
  ) {
    // Export users (exclude password hashes for security)
    const users = await Users.findAll({
      where: { tenantId },
      attributes: {
        exclude: ["password", "createdAt", "updatedAt", "deleted_at"],
      },
    });
    data.users = users.map((u) => u.toJSON());
  }

  return data;
}

/**
 * Create a backup for a tenant
 */
async function createBackup({
  tenantId,
  createdById,
  name,
  description,
  backupType = TenantBackup.BACKUP_TYPES.FULL,
  retentionDays = TenantBackup.DEFAULT_RETENTION_DAYS,
  tag,
  models,
}) {
  // Validate tenant exists
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // Create backup record
  const backup = await TenantBackup.createBackup(
    {
      tenantId,
      createdById,
      name,
      description,
      backupType,
      retentionDays,
      tag,
    },
    models,
  );

  // Update status to in progress
  await TenantBackup.updateStatus(
    backup.id,
    {
      status: TenantBackup.STATUS.IN_PROGRESS,
    },
    models,
  );

  try {
    // Export data
    const exportData = await exportTenantData(tenantId, backupType, models);

    // Create ZIP file
    const zip = new JSZip();
    const filename = `tenant_data_${backupType.toLowerCase()}.json`;
    zip.file(filename, JSON.stringify(exportData, null, 2));

    // Add metadata file
    zip.file(
      "backup_metadata.json",
      JSON.stringify(
        {
          backupId: backup.id,
          tenantId,
          createdById,
          createdAt: new Date().toISOString(),
          backupType,
          retentionDays,
          tag,
          description,
        },
        null,
        2,
      ),
    );

    // Generate ZIP
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // Ensure backup directory exists
    ensureBackupDirExists();

    // Save to file
    const filenameStr = generateBackupFilename(tenantId, backup.id);
    const filePath = path.join(BACKUP_DIR, filenameStr);
    fs.writeFileSync(filePath, zipBuffer);

    // Calculate checksum
    const checksum = await calculateChecksum(filePath);

    // Count records (simplified - only users now)
    const recordCount = exportData.users?.length || 0;

    // Update backup record
    await TenantBackup.updateStatus(
      backup.id,
      {
        status: TenantBackup.STATUS.COMPLETED,
        filePath,
        fileSize: zipBuffer.length,
        recordCount,
        metadata: {
          checksum,
          filename: filenameStr,
          exportedAt: new Date().toISOString(),
          dataVersion: exportData.metadata.version,
        },
      },
      models,
    );

    logger.info("Tenant backup created", {
      backupId: backup.id,
      tenantId,
      backupType,
      recordCount,
      fileSize: zipBuffer.length,
    });

    return {
      success: true,
      status: 201,
      message: "Backup created successfully",
      data: await TenantBackup.findByPk(backup.id, {
        include: [
          {
            model: models.Users,
            as: "creator",
            attributes: ["id", "username", "email"],
          },
        ],
      }),
    };
  } catch (error) {
    // Update backup record with error
    await TenantBackup.updateStatus(
      backup.id,
      {
        status: TenantBackup.STATUS.FAILED,
        errorMessage: error.message,
      },
      models,
    );

    logger.error("Tenant backup failed", {
      backupId: backup.id,
      tenantId,
      error: error.message,
    });

    throw new InternalServerError("Failed to create backup: " + error.message);
  }
}

/**
 * Download a backup file
 */
async function downloadBackup(backupId, models) {
  const backup = await TenantBackup.findByPk(backupId, {
    include: [
      {
        model: models.Tenants,
        as: "tenant",
      },
      {
        model: models.Users,
        as: "creator",
      },
    ],
  });

  if (!backup) {
    throw new AppError(404, "Backup not found");
  }

  if (backup.status !== TenantBackup.STATUS.COMPLETED) {
    throw new AppError(400, "Backup is not ready for download");
  }

  if (!backup.filePath || !fs.existsSync(backup.filePath)) {
    throw new AppError(404, "Backup file not found on storage");
  }

  return {
    success: true,
    status: 200,
    message: "Backup ready for download",
    data: {
      filePath: backup.filePath,
      metadata: backup,
    },
  };
}

/**
 * Restore a backup for a tenant (simplified)
 */
async function restoreBackup({
  backupId,
  restoredById,
  mergeData = false,
  models,
}) {
  const backup = await TenantBackup.findByPk(backupId, {
    include: [
      {
        model: models.Tenants,
        as: "tenant",
      },
    ],
  });

  if (!backup) {
    throw new AppError(404, "Backup not found");
  }

  if (backup.status !== TenantBackup.STATUS.COMPLETED) {
    throw new AppError(400, "Backup is not ready for restore");
  }

  if (!backup.filePath || !fs.existsSync(backup.filePath)) {
    throw new AppError(404, "Backup file not found on storage");
  }

  // Update backup status to restoring
  await TenantBackup.updateStatus(
    backupId,
    {
      status: TenantBackup.STATUS.RESTORING,
    },
    models,
  );

  try {
    // Extract and read the ZIP file
    const zip = new JSZip();
    const zipData = fs.readFileSync(backup.filePath);
    const extracted = await zip.loadAsync(zipData);

    // Find the tenant data file
    const dataFile = Object.keys(extracted.files).find((key) =>
      key.startsWith("tenant_data_"),
    );

    if (!dataFile) {
      throw new Error("Invalid backup file: no tenant data found");
    }

    const dataStr = await extracted.files[dataFile].async("string");
    const data = JSON.parse(dataStr);

    // Validate data structure
    if (!data.metadata || !data.tenant) {
      throw new Error("Invalid backup data structure");
    }

    const targetTenantId = data.tenant.id;
    let recordsProcessed = 0;

    // Get the transaction from models parameter for consistency
    const sequelize = models.sequelize || require("../models").sequelize;

    // Start transaction
    const transaction = await sequelize.transaction();

    try {
      // Restore users (simplified - no more settings/roles/features)
      if (data.users?.length > 0) {
        if (mergeData) {
          for (const user of data.users) {
            await Users.findOrCreate({
              where: {
                tenantId: targetTenantId,
                [sequelize.Op.or]: [
                  { username: user.username },
                  { email: user.email },
                ],
              },
              defaults: { ...user, id: undefined },
              transaction,
            });
          }
        } else {
          await Users.destroy({
            where: { tenantId: targetTenantId },
            transaction,
          });
          // Preserve password hashes from backup for non-merge restores
          await Users.bulkCreate(
            data.users.map((u) => ({
              ...u,
              id: undefined,
            })),
            { transaction },
          );
        }
        recordsProcessed += data.users.length;
      }

      // Commit transaction
      await transaction.commit();

      // Update backup status
      await TenantBackup.updateStatus(
        backupId,
        {
          status: TenantBackup.STATUS.RESTORED,
          metadata: {
            ...backup.metadata,
            restoredAt: new Date().toISOString(),
            restoredById,
            recordsProcessed,
          },
        },
        models,
      );

      logger.info("Tenant backup restored", {
        backupId,
        targetTenantId,
        recordsProcessed,
        restoredById,
      });

      return {
        success: true,
        status: 200,
        message: "Backup restored successfully",
        data: {
          tenantId: targetTenantId,
          recordsProcessed,
          restoredAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    // Update backup status with error
    await TenantBackup.updateStatus(
      backupId,
      {
        status: TenantBackup.STATUS.FAILED,
        errorMessage: error.message,
      },
      models,
    );

    logger.error("Tenant backup restore failed", {
      backupId,
      error: error.message,
    });

    throw new InternalServerError("Failed to restore backup: " + error.message);
  }
}

/**
 * Delete a backup
 */
async function deleteBackup(backupId, deletedById, models) {
  const backup = await TenantBackup.findByPk(backupId);

  if (!backup) {
    throw new AppError(404, "Backup not found");
  }

  // Update status to deleting
  await TenantBackup.updateStatus(
    backupId,
    {
      status: TenantBackup.STATUS.DELETING,
    },
    models,
  );

  try {
    // Delete file from storage
    if (backup.filePath && fs.existsSync(backup.filePath)) {
      fs.unlinkSync(backup.filePath);
    }

    // Soft delete the record
    await backup.destroy();

    logger.info("Tenant backup deleted", {
      backupId,
      deletedById,
    });

    return {
      success: true,
      status: 200,
      message: "Backup deleted successfully",
      data: null,
    };
  } catch (error) {
    // Revert status if deletion fails
    await TenantBackup.updateStatus(
      backupId,
      {
        status: TenantBackup.STATUS.COMPLETED,
      },
      models,
    );

    logger.error("Tenant backup deletion failed", {
      backupId,
      error: error.message,
    });

    throw new InternalServerError("Failed to delete backup: " + error.message);
  }
}

/**
 * Get backup statistics for a tenant
 */
async function getBackupStats(tenantId, models) {
  const totalBackups = await TenantBackup.count({ where: { tenantId } });
  const completedBackups = await TenantBackup.count({
    where: { tenantId, status: TenantBackup.STATUS.COMPLETED },
  });
  const failedBackups = await TenantBackup.count({
    where: { tenantId, status: TenantBackup.STATUS.FAILED },
  });

  const totalSizeResult = await TenantBackup.findAll({
    where: {
      tenantId,
      status: TenantBackup.STATUS.COMPLETED,
      fileSize: { [Op.ne]: null },
    },
    attributes: [
      [Sequelize.fn("SUM", Sequelize.col("file_size")), "totalSize"],
    ],
  });

  const rawTotalSize = totalSizeResult[0]?.dataValues?.totalSize;
  const totalSize = rawTotalSize ? parseFloat(rawTotalSize) : 0;

  const latestBackup = await TenantBackup.getLatestBackup(tenantId, models);

  return {
    success: true,
    status: 200,
    message: "Backup statistics retrieved successfully",
    data: {
      totalBackups,
      completedBackups,
      failedBackups,
      totalSize,
      latestBackup,
      hasValidBackups: await TenantBackup.hasValidBackups(tenantId, models),
    },
  };
}

/**
 * Clean up expired backups and their physical files
 */
async function cleanupExpiredBackups(tenantId, models) {
  const where = {
    status: TenantBackup.STATUS.COMPLETED,
    expiresAt: {
      [Op.lt]: new Date(),
    },
  };

  if (tenantId) {
    where.tenantId = tenantId;
  }

  const expiredBackups = await TenantBackup.findAll({ where });

  let deletedCount = 0;

  for (const backup of expiredBackups) {
    try {
      // Delete physical file
      if (backup.filePath && fs.existsSync(backup.filePath)) {
        fs.unlinkSync(backup.filePath);
      }

      // Soft delete the record
      await backup.destroy();
      deletedCount++;
    } catch (error) {
      logger.error("Failed to clean up expired backup", {
        backupId: backup.id,
        error: error.message,
      });
    }
  }

  if (deletedCount > 0) {
    logger.info("Cleaned up expired backups", {
      deletedCount,
      tenantId,
    });
  }

  return {
    success: true,
    status: 200,
    message: "Expired backups cleanup completed",
    data: { deletedCount },
  };
}

module.exports = {
  createBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupStats,
  cleanupExpiredBackups,
  BACKUP_DIR,
};
