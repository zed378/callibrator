/**
 * GDPR/CCPA Compliance Service
 *
 * Provides data export, right-to-erasure, consent management, and
 * privacy preference handling for multi-tenant SaaS compliance.
 *
 * Usage:
 *   const { exportUserData, eraseUserData } = require('./services/gdpr.service');
 *   await exportUserData(tenantId, userId);
 */

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { db } = require("../config");
const storagePath = require("../utils/storagePath.util");

// ==========================================
// CONFIGURATION
// ==========================================

const isGdprEnabled = () => process.env.GDPR_ENABLED !== "false";
const EXPORT_RETENTION_HOURS =
  parseInt(process.env.EXPORT_RETENTION_HOURS) || 168; // 7 days
const ERASURE_BATCH_SIZE = parseInt(process.env.ERASURE_BATCH_SIZE) || 100;
const CONSENT_REQUIRED = process.env.CONSENT_REQUIRED === "true";

// ==========================================
// DATA EXPORT
// ==========================================

/**
 * Export all user data for GDPR Article 15 (Right of Access)
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @param {Object} options - Export options
 * @returns {Promise<{exportId: string, downloadUrl: string, expiresAt: string}>}
 */
exports.exportUserData = async (tenantId, userId, options = {}) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Data export is disabled");
  }

  const exportId = generateExportId();
  const exportDir = storagePath("exports", exportId);

  try {
    // Create export directory
    await fs.promises.mkdir(exportDir, { recursive: true });

    // Export user profile
    await exportUserProfile(exportDir, tenantId, userId);

    // Export tenant data
    await exportTenantData(exportDir, tenantId, userId);

    // Export audit logs
    await exportAuditLogs(exportDir, tenantId, userId);

    // Export calibration data
    await exportCalibrationData(exportDir, tenantId, userId);

    // Create ZIP archive
    const zipPath = await createZipArchive(exportDir, exportId);

    // Schedule cleanup
    scheduleExportCleanup(exportDir, zipPath);

    logger.info("User data export completed", {
      tenantId,
      userId,
      exportId,
    });

    return {
      exportId,
      downloadUrl: `/api/v1/gdpr/exports/${exportId}/download`,
      expiresAt: new Date(
        Date.now() + EXPORT_RETENTION_HOURS * 3600000,
      ).toISOString(),
      fileSize: await getFileSize(zipPath),
    };
  } catch (err) {
    logger.error("Data export failed", {
      tenantId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to export user data");
  }
};

/**
 * Export user profile data
 */
async function exportUserProfile(exportDir, tenantId, userId) {
  const { User, Role } = require("../models");

  const user = await User.findOne({
    where: { id: userId, tenantId },
    include: [Role],
    raw: true,
  });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  const profileData = {
    exportDate: new Date().toISOString(),
    requestType: "Data Export (GDPR Article 15)",
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.Role?.name,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
  };

  await fs.promises.writeFile(
    path.join(exportDir, "user_profile.json"),
    JSON.stringify(profileData, null, 2),
  );
}

/**
 * Export tenant data associated with user
 */
async function exportTenantData(exportDir, tenantId, userId) {
  const tables = [
    "Stocks",
    "StockTransfers",
    "StockAdjustments",
    "StockOpnames",
    "CalibrationDevices",
    "CalibrationRecords",
    "Certificates",
    "MaintenanceWorkOrders",
    "Notifications",
  ];

  const allData = {};

  for (const table of tables) {
    try {
      const Model = require("../models")[table];
      if (Model) {
        const records = await Model.findAll({
          where: db.getDialect() === "postgres" ? { tenantId } : { tenantId },
          limit: 1000,
          raw: true,
        });
        allData[table] = records;
      }
    } catch (err) {
      logger.warn(`Failed to export ${table}`, { error: err.message });
    }
  }

  await fs.promises.writeFile(
    path.join(exportDir, "tenant_data.json"),
    JSON.stringify(allData, null, 2),
  );
}

/**
 * Export audit logs for user
 */
async function exportAuditLogs(exportDir, tenantId, userId) {
  const { AuditLog } = require("../models");

  try {
    const logs = await AuditLog.findAll({
      where: {
        tenantId,
        [db.Sequelize.Op.or]: [{ userId }, { performedBy: userId }],
      },
      limit: 5000,
      raw: true,
    });

    await fs.promises.writeFile(
      path.join(exportDir, "audit_logs.json"),
      JSON.stringify(logs, null, 2),
    );
  } catch (err) {
    logger.warn("Failed to export audit logs", { error: err.message });
    await fs.promises.writeFile(
      path.join(exportDir, "audit_logs.json"),
      JSON.stringify({ error: "Failed to export" }, null, 2),
    );
  }
}

/**
 * Export calibration data
 */
async function exportCalibrationData(exportDir, tenantId, userId) {
  const {
    CalibrationDevice,
    CalibrationRecord,
    Certificate,
  } = require("../models");

  try {
    const devices = await CalibrationDevice.findAll({
      where: { tenantId },
      raw: true,
    });

    const deviceIds = devices.map((d) => d.id);

    const records =
      deviceIds.length > 0
        ? await CalibrationRecord.findAll({
            where: { deviceId: deviceIds },
            raw: true,
          })
        : [];

    const certificates =
      deviceIds.length > 0
        ? await Certificate.findAll({
            where: { deviceId: deviceIds },
            raw: true,
          })
        : [];

    await fs.promises.writeFile(
      path.join(exportDir, "calibration_data.json"),
      JSON.stringify({ devices, records, certificates }, null, 2),
    );
  } catch (err) {
    logger.warn("Failed to export calibration data", { error: err.message });
  }
}

/**
 * Create ZIP archive of export
 */
async function createZipArchive(exportDir, exportId) {
  const zipPath = storagePath("exports", `${exportId}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    archive.on("error", (err) => reject(err));
    archive.pipe(output);
    archive.directory(exportDir, false);
    archive.finalize();

    output.on("close", () => resolve(zipPath));
    archive.on("end", () => resolve(zipPath));
  });
}

/**
 * Schedule export cleanup
 */
function scheduleExportCleanup(exportDir, zipPath) {
  const cleanupTime = EXPORT_RETENTION_HOURS * 3600000;

  setTimeout(() => {
    try {
      if (fs.existsSync(exportDir)) {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      logger.info("Export cleaned up", { exportId: path.basename(exportDir) });
    } catch (err) {
      logger.warn("Export cleanup failed", { error: err.message });
    }
  }, cleanupTime);
}

/**
 * Get file size
 */
async function getFileSize(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Generate export ID
 */
function generateExportId() {
  const crypto = require("crypto");
  return `export-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// ==========================================
// RIGHT TO ERASURE (Right to be Forgotten)
// ==========================================

/**
 * Erase user data for GDPR Article 17 (Right to Erasure)
 * Performs soft delete with anonymization where required
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID to erase
 * @param {Object} options - Erasure options
 */
exports.eraseUserData = async (tenantId, userId, options = {}) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Data erasure is disabled");
  }

  const hardDelete = options.hardDelete === true;
  const anonymize = options.anonymize !== false;

  try {
    // Create erasure audit record before deleting
    await logErasureRequest(tenantId, userId, hardDelete, anonymize);

    // Anonymize or delete user
    if (anonymize) {
      await anonymizeUser(tenantId, userId);
    } else if (hardDelete) {
      await hardDeleteUser(tenantId, userId);
    } else {
      await softDeleteUser(tenantId, userId);
    }

    logger.info("User data erased", {
      tenantId,
      userId,
      hardDelete,
      anonymize,
    });

    return {
      erased: true,
      method: anonymize
        ? "anonymized"
        : hardDelete
          ? "hard_deleted"
          : "soft_deleted",
      erasureDate: new Date().toISOString(),
    };
  } catch (err) {
    logger.error("Data erasure failed", {
      tenantId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to erase user data");
  }
};

/**
 * Anonymize user data
 */
async function anonymizeUser(tenantId, userId) {
  const { User } = require("../models");

  await User.update(
    {
      email: `erased_${userId}@erased.local`,
      username: `erased_${userId.substring(0, 8)}`,
      firstName: "[REDACTED]",
      lastName: "[REDACTED]",
      phone: null,
      status: "erased",
    },
    { where: { id: userId, tenantId } },
  );
}

/**
 * Soft delete user
 */
async function softDeleteUser(tenantId, userId) {
  const { User } = require("../models");

  await User.update(
    {
      status: "deleted",
      deletedAt: new Date(),
    },
    { where: { id: userId, tenantId } },
  );
}

/**
 * Hard delete user
 */
async function hardDeleteUser(tenantId, userId) {
  const { User } = require("../models");

  await User.destroy({ where: { id: userId, tenantId } });
}

/**
 * Log erasure request
 */
async function logErasureRequest(tenantId, userId, hardDelete, anonymize) {
  const { AuditLog } = require("../models");

  // Map onto the actual AuditLog schema: `action` is an ENUM
  // (CREATE|UPDATE|DELETE|LOGIN|APPROVE|EXPORT) and before/after live under
  // the `changes` JSONB column. Using an out-of-enum action or non-existent
  // columns (the previous "GDPR_ERASURE"/entityType/before/after) would fail
  // the insert and silently drop the erasure audit record.
  await AuditLog.create({
    tenantId,
    userId: null,
    action: "DELETE",
    resourceType: "User",
    resourceId: userId,
    changes: {
      reason: "GDPR_ERASURE",
      before: { userId, hardDelete, anonymize },
      after: { erasedAt: new Date().toISOString() },
    },
  });
}

// ==========================================
// CONSENT MANAGEMENT
// ==========================================

/**
 * Record user consent for data processing
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @param {string} purpose - Consent purpose
 * @param {string} version - Consent version
 * @param {string} ip - User IP
 * @returns {Promise<{consentId: string}>}
 */
exports.recordConsent = async (
  tenantId,
  userId,
  purpose,
  version = "1.0",
  ip = "",
) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Consent management is disabled");
  }

  try {
    const { ConsentRecord } = require("../models");

    const record = await ConsentRecord.create({
      tenantId,
      userId,
      purpose,
      version,
      ipAddress: ip,
      consentedAt: new Date(),
      status: "granted",
    });

    logger.info("Consent recorded", {
      tenantId,
      userId,
      purpose,
      version,
    });

    return { consentId: record.id };
  } catch (err) {
    logger.error("Failed to record consent", {
      tenantId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to record consent");
  }
};

/**
 * Withdraw user consent
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @param {string} purpose - Consent purpose to withdraw
 */
exports.withdrawConsent = async (tenantId, userId, purpose) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Consent management is disabled");
  }

  try {
    const { ConsentRecord } = require("../models");

    await ConsentRecord.update(
      {
        status: "withdrawn",
        withdrawnAt: new Date(),
      },
      {
        where: { tenantId, userId, purpose, status: "granted" },
      },
    );

    logger.info("Consent withdrawn", { tenantId, userId, purpose });
    return { withdrawn: true };
  } catch (err) {
    logger.error("Failed to withdraw consent", {
      tenantId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to withdraw consent");
  }
};

/**
 * Get user consent history
 */
exports.getConsentHistory = async (tenantId, userId) => {
  try {
    const { ConsentRecord } = require("../models");

    const records = await ConsentRecord.findAll({
      where: { tenantId, userId },
      order: [["consentedAt", "DESC"]],
    });

    return records;
  } catch (err) {
    logger.error("Failed to get consent history", {
      tenantId,
      userId,
      error: err.message,
    });
    return [];
  }
};

/**
 * Update consent across one or more categories in a single call.
 * consent=true grants each category; consent=false withdraws each.
 * @param {string} tenantId
 * @param {string} userId
 * @param {string[]} categories
 * @param {boolean} consent
 * @param {string} [ip]
 */
exports.updateConsent = async (tenantId, userId, categories, consent, ip = "") => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Consent management is disabled");
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new AppError(400, "categories must be a non-empty array");
  }
  if (typeof consent !== "boolean") {
    throw new AppError(400, "consent must be a boolean");
  }

  for (const purpose of categories) {
    if (consent) {
      await exports.recordConsent(tenantId, userId, purpose, "1.0", ip);
    } else {
      await exports.withdrawConsent(tenantId, userId, purpose);
    }
  }

  return { updated: categories.length, consent, categories };
};

// ==========================================
// PROCESSING ACTIVITIES / RECTIFICATION / RESTRICTION
// ==========================================

/**
 * Records of processing activities (GDPR Article 30). Returns the disclosure of
 * how the platform processes the subject's personal data.
 */
exports.getProcessingActivities = async (tenantId, userId) => {
  return {
    controller: "Hospital Device Calibration Platform",
    tenantId,
    subjectId: userId,
    generatedAt: new Date().toISOString(),
    activities: [
      {
        purpose: "Account & authentication",
        legalBasis: "Contract",
        dataCategories: ["identity", "credentials", "session metadata"],
        retention: "Life of the account",
      },
      {
        purpose: "Calibration & maintenance records",
        legalBasis: "Legal obligation (ISO 17025)",
        dataCategories: ["device", "measurements", "operator identity"],
        retention: "Per data-retention policy",
      },
      {
        purpose: "Audit trail",
        legalBasis: "Legal obligation (FDA 21 CFR Part 11)",
        dataCategories: ["actor", "action", "timestamp", "ip address"],
        retention: "At least the lifetime of the underlying record",
      },
      {
        purpose: "Notifications",
        legalBasis: "Legitimate interest",
        dataCategories: ["contact details"],
        retention: "Per data-retention policy",
      },
      {
        purpose: "Billing & subscription",
        legalBasis: "Contract",
        dataCategories: ["subscription", "invoices"],
        retention: "Statutory financial retention period",
      },
    ],
  };
};

/**
 * Rectify a personal-data field (GDPR Article 16). Only a whitelist of
 * self-service profile fields may be changed here.
 */
exports.rectifyData = async (tenantId, userId, field, value) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Rectification is disabled");
  }
  const ALLOWED_FIELDS = ["firstName", "lastName", "phone", "email"];
  if (!ALLOWED_FIELDS.includes(field)) {
    throw new AppError(
      400,
      `Field "${field}" cannot be rectified. Allowed: ${ALLOWED_FIELDS.join(", ")}`,
    );
  }

  const { User, AuditLog } = require("../models");
  const [count] = await User.update(
    { [field]: value },
    { where: { id: userId, tenantId } },
  );
  if (count === 0) {
    throw new AppError(404, "User not found");
  }

  try {
    await AuditLog.create({
      tenantId,
      userId,
      action: "UPDATE",
      resourceType: "User",
      resourceId: userId,
      changes: { reason: "GDPR_RECTIFICATION", field, after: value },
    });
  } catch (err) {
    logger.warn("Failed to audit rectification", { error: err.message });
  }

  logger.info("Personal data rectified", { tenantId, userId, field });
  return { rectified: true, field };
};

/**
 * Restrict processing (GDPR Article 18). Recorded as a DSAR of type
 * "restriction" for the compliance team to act on.
 */
exports.restrictProcessing = async (tenantId, userId, reason) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Processing restriction is disabled");
  }
  const dsar = await exports.createDsar(tenantId, userId, "restriction", {
    reason: reason || null,
  });
  logger.info("Processing restriction requested", { tenantId, userId });
  return { restricted: true, requestId: dsar.dsarId };
};

// ==========================================
// PRIVACY PREFERENCES
// ==========================================

/**
 * Update user privacy preferences
 */
exports.updatePrivacyPreferences = async (tenantId, userId, preferences) => {
  try {
    const { User } = require("../models");

    await User.update(
      { privacyPreferences: preferences },
      { where: { id: userId, tenantId } },
    );

    logger.info("Privacy preferences updated", { tenantId, userId });
    return { success: true };
  } catch (err) {
    logger.error("Failed to update privacy preferences", {
      tenantId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to update preferences");
  }
};

/**
 * Get user privacy preferences
 */
exports.getPrivacyPreferences = async (tenantId, userId) => {
  try {
    const { User } = require("../models");

    const user = await User.findByPk(userId);
    return user?.privacyPreferences || {};
  } catch (err) {
    logger.error("Failed to get privacy preferences", {
      tenantId,
      userId,
      error: err.message,
    });
    return {};
  }
};

// ==========================================
// DATA RETENTION
// ==========================================

/**
 * Enforce data retention policies
 * Purges data past retention period
 */
exports.enforceDataRetention = async () => {
  if (!isGdprEnabled()) {
    return { enforced: false, reason: "GDPR disabled" };
  }

  try {
    const { DataRetentionPolicy } = require("../models");

    const policies = await DataRetentionPolicy.findAll({
      where: { isActive: true },
    });

    let purged = 0;

    for (const policy of policies) {
      const result = await purgeExpiredData(policy);
      purged += result;
    }

    logger.info("Data retention enforced", { purged });
    return { enforced: true, purged };
  } catch (err) {
    logger.error("Data retention enforcement failed", { error: err.message });
    return { enforced: false, error: err.message };
  }
};

/**
 * Purge expired data for a single retention policy.
 *
 * Deletes rows of the policy's entity type older than its retention window for
 * the policy's tenant, honoring an active legal hold. Entity types with no known
 * backing model are logged and skipped (return 0) rather than throwing.
 */
async function purgeExpiredData(policy) {
  const models = require("../models");
  const { Op } = require("sequelize");
  const dataRetention = require("./dataRetention.service");

  // Map a policy's entityType (either the snake_case retention key or the model
  // name) to its Sequelize model.
  const ENTITY_MODEL = {
    audit_logs: models.AuditLog,
    AuditLog: models.AuditLog,
    notifications: models.Notification,
    Notification: models.Notification,
    sessions: models.Session,
    Session: models.Session,
  };

  const model = ENTITY_MODEL[policy.entityType];
  if (!model) {
    logger.debug("No purge handler for entity type; skipping", {
      policyId: policy.id,
      entityType: policy.entityType,
    });
    return 0;
  }

  // Never purge a tenant under legal hold.
  if (policy.tenantId && (await dataRetention.isOnLegalHold(policy.tenantId))) {
    logger.info("Purge skipped: legal hold active", {
      tenantId: policy.tenantId,
      entityType: policy.entityType,
    });
    return 0;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (policy.retentionDays || 0));

  const where = { createdAt: { [Op.lt]: cutoff } };
  if (policy.tenantId) {
    where.tenantId = policy.tenantId;
  }

  const deleted = await model.destroy({ where });

  logger.info("Purged expired data", {
    policyId: policy.id,
    entityType: policy.entityType,
    deleted,
  });

  return deleted || 0;
}

// ==========================================
// DSAR (Data Subject Access Request)
// ==========================================

/**
 * Create a DSAR
 */
exports.createDsar = async (tenantId, userId, type, details = {}) => {
  try {
    const { DsarRequest } = require("../models");

    const dsar = await DsarRequest.create({
      tenantId,
      userId,
      type, // "export", "erasure", "rectification"
      status: "pending",
      details,
      requestedAt: new Date(),
    });

    logger.info("DSAR created", { tenantId, userId, type, dsarId: dsar.id });
    return { dsarId: dsar.id };
  } catch (err) {
    logger.error("Failed to create DSAR", {
      tenantId,
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to create DSAR");
  }
};

/**
 * Get DSAR status
 */
exports.getDsarStatus = async (tenantId, dsarId) => {
  try {
    const { DsarRequest } = require("../models");

    const dsar = await DsarRequest.findOne({
      where: { tenantId, id: dsarId },
    });

    return dsar || null;
  } catch (err) {
    logger.error("Failed to get DSAR status", { error: err.message });
    return null;
  }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get service status
 */
exports.getStatus = () => {
  return {
    enabled: isGdprEnabled(),
    exportRetentionHours: EXPORT_RETENTION_HOURS,
    consentRequired: CONSENT_REQUIRED,
  };
};
