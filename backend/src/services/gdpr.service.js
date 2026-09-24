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
const { Op } = require("sequelize");
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

  // A-140: `User` is associated to `Role` under the alias `role`
  // (user.model.js). `include: [Role]` without it made Sequelize throw before
  // any query ran, so every Article 15 export failed. No `raw: true`: it
  // flattens an include to `"role.name"` keys, and `user.role` would be unset.
  // The role is a LEFT JOIN — a user whose role was deleted (role_id SET NULL)
  // is still owed their data. The attributes are named, so no credential or
  // second-factor column is ever selected into an export.
  const user = await User.findOne({
    where: { id: userId, tenantId },
    attributes: [
      "id",
      "email",
      "username",
      "firstName",
      "lastName",
      "phone",
      "avatarUrl",
      "status",
      "createdAt",
      "lastLoginAt",
    ],
    include: [
      { model: Role, as: "role", attributes: ["id", "name"], required: false },
    ],
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
      // Personal data the subject is owed and the export used to omit.
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role?.name ?? null,
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
          where: { tenantId },
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
    // The rows the subject acted in: as the principal, or as the super admin
    // behind an impersonation (F-8). `performedBy` is not an audit_logs
    // column; filtering on it made PostgreSQL reject the query, and the
    // subject received an error object in place of their own audit rows.
    const logs = await AuditLog.findAll({
      where: {
        tenantId,
        [Op.or]: [{ userId }, { impersonatorId: userId }],
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
 * @param {string} options.requestedBy - A-124: the user who requested the
 *   erasure; the audit row's actor. Refused (400) when absent — an erasure is
 *   never recorded without one.
 */
exports.eraseUserData = async (tenantId, userId, options = {}) => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Data erasure is disabled");
  }
  if (!options.requestedBy) {
    throw new AppError(400, "An erasure must name the user who requested it");
  }

  const hardDelete = options.hardDelete === true;
  const anonymize = options.anonymize !== false;

  try {
    // Create erasure audit record before deleting
    await logErasureRequest(tenantId, userId, hardDelete, anonymize, options.requestedBy);

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
async function logErasureRequest(tenantId, userId, hardDelete, anonymize, requestedBy) {
  const { AuditLog } = require("../models");

  // Map onto the actual AuditLog schema: `action` is an ENUM
  // (CREATE|UPDATE|DELETE|LOGIN|APPROVE|EXPORT) and before/after live under
  // the `changes` JSONB column. Using an out-of-enum action or non-existent
  // columns (the previous "GDPR_ERASURE"/entityType/before/after) would fail
  // the insert and silently drop the erasure audit record.
  await AuditLog.create({
    tenantId,
    // A-124 (ADR-051 Q-13): the requester is the actor — never a null user.
    userId: requestedBy,
    actorType: "user",
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
      actorType: "user", // A-124: the authenticated requester
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
//
// A-121 (ADR-051 Q-10, F-4): this service used to carry a second purge engine
// (`enforceDataRetention` / `purgeExpiredData`) over `data_retention_policies`.
// It had no caller, wrote no audit row, ran with no transaction, treated a
// 0-day policy as "delete everything up to now" (the opposite of the live
// engine), and could destroy a tenant's audit rows. It is removed. The one
// retention engine is `dataRetention.service` (scheduled nightly by
// retentionScheduler), and audit rows are never purged (Q-12).

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
