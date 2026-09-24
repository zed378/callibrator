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
const { deleteUpload } = require("../utils/upload.util");
const { db } = require("../config");
const auditService = require("./audit.service");

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

    // A-151: the records that name the subject — never whole-tenant tables
    await exportSubjectRecords(exportDir, tenantId, userId);

    // A-180: the subject's consent history, DSARs and sessions
    await exportPrivacyRecords(exportDir, tenantId, userId);

    // Export audit logs
    await exportAuditLogs(exportDir, tenantId, userId);

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
    // A-151: an unpacked export must not linger on disk for 7 days with no
    // cleanup scheduled; `force` makes a missing directory a no-op.
    await fs.promises.rm(exportDir, { recursive: true, force: true });
    // A-151: "no such subject" is a 404 — it was rewritten into a 500.
    if (err instanceof AppError && err.status < 500) {
      throw err;
    }
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
 * A-151 — the operational records that NAME the data subject, per table, and
 * the columns that name them. Written out by hand: each entry is a claim that
 * the column holds a user id, checked against its model.
 *
 * The previous export dumped whole-tenant tables into one person's Article 15
 * archive — every stock row, device, calibration record, certificate and
 * notification of the hospital (up to 1,000 per table), i.e. other people's
 * data, sent to whoever asked. `userId` was accepted and never used. Stocks
 * and calibration devices name no user at all, so they are not here.
 */
const SUBJECT_RECORDS = Object.freeze([
  { model: "StockTransfer", columns: ["requestedBy", "approvedBy"] },
  { model: "StockAdjustment", columns: ["adjustedBy"] },
  { model: "StockOpname", columns: ["performedBy"] },
  { model: "CalibrationRecord", columns: ["performedBy"] },
  {
    model: "Certificate",
    columns: ["calibratedBy", "approvedBy", "signedBy", "createdBy", "updatedBy"],
  },
  { model: "MaintenanceWorkOrder", columns: ["assignedTo"] },
  { model: "Notification", columns: ["userId"] },
]);

/** The most rows exported per table. */
const SUBJECT_RECORD_LIMIT = 1000;

/**
 * Export the records that name the subject (`SUBJECT_RECORDS`), each filtered
 * by the tenant AND by the subject's user id in one of its columns.
 *
 * A failure is not swallowed: an Article 15 answer that silently omits a
 * table is an incomplete answer presented as a complete one. The export fails
 * and the requester can retry.
 *
 * @param {string} exportDir - the export's working directory
 * @param {string} tenantId - the subject's tenant
 * @param {string} userId - the data subject
 * @returns {Promise<void>} resolves when subject_records.json is written
 */
async function exportSubjectRecords(exportDir, tenantId, userId) {
  const models = require("../models");
  const records = {};

  for (const { model, columns } of SUBJECT_RECORDS) {
    records[model] = await models[model].findAll({
      where: {
        tenantId,
        [Op.or]: columns.map((column) => ({ [column]: userId })),
      },
      limit: SUBJECT_RECORD_LIMIT,
      raw: true,
    });
  }

  await fs.promises.writeFile(
    path.join(exportDir, "subject_records.json"),
    JSON.stringify(records, null, 2),
  );
}

/**
 * A-180 — the session attributes an Article 15 export carries. `token_hash`
 * is a credential (the SHA-256 a refresh token is checked against), so it is
 * not here; the list is an allow-list so a column added later stays out until
 * someone decides the subject is owed it.
 */
const EXPORTED_SESSION_ATTRIBUTES = Object.freeze([
  "id",
  "impersonator_id",
  "ip_address",
  "user_agent",
  "device",
  "created_at",
  "last_activity_at",
  "expired_at",
  "is_active",
  "is_revoked",
  "revoked_at",
  "revoked_reason",
]);

/** The session fields that describe the impersonator, not the subject. */
const IMPERSONATOR_SESSION_FIELDS = Object.freeze(["ip_address", "user_agent", "device"]);

/**
 * Export the privacy records that are about the subject (A-180): their consent
 * history (GDPR Art. 7(1) — every grant and withdrawal), their data-subject
 * requests, and their sign-in sessions. Each read is filtered by the tenant
 * AND the subject. Before A-180 the Article 15 archive omitted all three.
 *
 * A session a super admin opened by impersonating the subject records the
 * IMPERSONATOR's network address, user agent and device — someone else's
 * personal data. Those fields are withheld on such a row; the row itself
 * (the fact that the account was used, when, and that it was impersonated)
 * is the subject's.
 *
 * A failure is not swallowed (the A-151 rule): an Article 15 answer that
 * silently omits a table is an incomplete answer presented as complete.
 *
 * @param {string} exportDir - the export's working directory
 * @param {string} tenantId - the subject's tenant
 * @param {string} userId - the data subject
 * @returns {Promise<void>} resolves when privacy_records.json is written
 */
async function exportPrivacyRecords(exportDir, tenantId, userId) {
  const { ConsentRecord, DsarRequest, Session } = require("../models");

  const consentHistory = await ConsentRecord.findAll({
    where: { tenantId, userId },
    attributes: [
      "id",
      "purpose",
      "version",
      "status",
      "ipAddress",
      "consentedAt",
      "withdrawnAt",
      "createdAt",
    ],
    order: [["consentedAt", "DESC"]],
    limit: SUBJECT_RECORD_LIMIT,
    raw: true,
  });

  const dsarRequests = await DsarRequest.findAll({
    where: { tenantId, userId },
    attributes: ["id", "type", "status", "details", "requestedAt", "completedAt"],
    order: [["requestedAt", "DESC"]],
    limit: SUBJECT_RECORD_LIMIT,
    raw: true,
  });

  // `sessions` is snake_case (CLAUDE.md § Traps), and the defaultScope hides
  // soft-deleted rows — which are still the subject's history, so unscoped.
  const sessionRows = await Session.unscoped().findAll({
    where: { tenant_id: tenantId, user_id: userId },
    attributes: [...EXPORTED_SESSION_ATTRIBUTES],
    order: [["created_at", "DESC"]],
    limit: SUBJECT_RECORD_LIMIT,
    raw: true,
  });
  const sessions = sessionRows.map((row) => {
    if (!row.impersonator_id) {
      return row;
    }
    const withheld = { ...row, impersonated: true };
    for (const field of IMPERSONATOR_SESSION_FIELDS) {
      withheld[field] = null;
    }
    delete withheld.impersonator_id;
    return withheld;
  });

  await fs.promises.writeFile(
    path.join(exportDir, "privacy_records.json"),
    JSON.stringify({ consentHistory, dsarRequests, sessions }, null, 2),
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
  const method = anonymize ? "anonymized" : hardDelete ? "hard_deleted" : "soft_deleted";
  let avatarFile = null;

  try {
    // A-153 / A-154: the erasure and the audit row that records it are ONE
    // transaction. The row used to be written first, on its own, so a failed
    // erasure left a permanent record of an erasure that did not happen.
    await db.transaction(async (transaction) => {
      const { User } = require("../models");
      const user = await User.findOne({
        where: { id: userId, tenantId },
        attributes: ["id", "avatarUrl"],
        transaction,
      });
      if (!user) {
        throw new AppError(404, "User not found");
      }

      let sessionsRevoked = 0;
      if (anonymize) {
        ({ avatarFile, sessionsRevoked } = await anonymizeUser(tenantId, user, transaction));
      } else if (hardDelete) {
        await hardDeleteUser(tenantId, userId, transaction);
      } else {
        await softDeleteUser(tenantId, userId, transaction);
      }

      await auditService.logAction(
        {
          tenantId,
          // A-124 (ADR-051 Q-13): the requester is the actor — never a null user.
          userId: options.requestedBy,
          action: "DELETE",
          resourceType: "User",
          resourceId: userId,
          // Which erasure, not what was erased: the trail is never purged.
          changes: {
            operation: "GDPR_ERASURE",
            method,
            sessionsRevoked,
            avatarRemoved: Boolean(avatarFile),
          },
        },
        { transaction },
      );
    });
  } catch (err) {
    logger.error("Data erasure failed", {
      tenantId,
      userId,
      error: err.message,
    });
    if (err instanceof AppError && err.status < 500) {
      throw err;
    }
    throw new AppError(500, "Failed to erase user data");
  }

  // A-154: the avatar file goes AFTER the commit that stopped referencing it.
  // A rolled-back erasure keeps its file; a leftover file after a committed
  // one is a storage leak to log, not a reason to report the erasure failed.
  if (avatarFile) {
    try {
      await deleteUpload(avatarFile, AVATAR_FOLDER);
    } catch (err) {
      logger.warn("Failed to delete an erased user's avatar file", {
        userId,
        error: err.message,
      });
    }
  }

  logger.info("User data erased", {
    tenantId,
    userId,
    hardDelete,
    anonymize,
  });

  return {
    erased: true,
    method,
    erasureDate: new Date().toISOString(),
  };
};

/** Where avatars are stored (user.service), and its "no photo" sentinel. */
const AVATAR_FOLDER = "uploads/profile";
const AVATAR_PLACEHOLDER = "default.svg";

/**
 * Every second-factor and one-time-code column back to "never enrolled"
 * (A-154). The TOTP set is mfa.service's MFA_CLEARED; the WebAuthn and OTP
 * columns are the account's other authenticators.
 */
const AUTHENTICATORS_CLEARED = Object.freeze({
  webauthnEnabled: false,
  webauthnCredentialId: null,
  webauthnPublicKey: null,
  webauthnSignCount: 0,
  otpCode: null,
  otpExpiredAt: null,
});

/**
 * Anonymize an account in place (A-154), inside the caller's transaction:
 * identity replaced, avatar reference dropped, every second factor and
 * one-time code cleared, the account deactivated, and every session revoked.
 * Before A-154 only the name, email and phone changed: the avatar photo, the
 * live sessions, the TOTP secret and recovery codes and the passkey stayed.
 *
 * @param {string} tenantId - the subject's tenant
 * @param {{id: string, avatarUrl: (string|null)}} user - the loaded account
 * @param {object} transaction - the erasure's transaction
 * @returns {Promise<{avatarFile: (string|null), sessionsRevoked: number}>}
 *   the avatar file to delete after commit, and how many sessions ended
 */
async function anonymizeUser(tenantId, user, transaction) {
  const { User } = require("../models");
  // Lazily: mfa.service loads otplib, session.service the Session model.
  const { MFA_CLEARED } = require("./mfa.service");
  const { revokeOtherSessions } = require("./session.service");
  const userId = user.id;

  const stored = user.avatarUrl ? String(user.avatarUrl).split("/").pop() : null;
  const avatarFile = stored && stored !== AVATAR_PLACEHOLDER ? stored : null;

  await User.update(
    {
      email: `erased_${userId}@erased.local`,
      username: `erased_${userId.substring(0, 8)}`,
      firstName: "[REDACTED]",
      lastName: "[REDACTED]",
      phone: null,
      // The column is NOT NULL; the placeholder is its "no photo" value.
      avatarUrl: AVATAR_PLACEHOLDER,
      status: "erased",
      // An erased account never signs in again (auth refuses !isActive).
      isActive: false,
      ...MFA_CLEARED,
      ...AUTHENTICATORS_CLEARED,
    },
    { where: { id: userId, tenantId }, transaction },
  );

  const sessionsRevoked = await revokeOtherSessions(userId, null, "GDPR_ERASURE", {
    transaction,
  });

  return { avatarFile, sessionsRevoked };
}

/**
 * Soft delete user
 */
async function softDeleteUser(tenantId, userId, transaction) {
  const { User } = require("../models");

  await User.update(
    {
      status: "deleted",
      deletedAt: new Date(),
    },
    { where: { id: userId, tenantId }, transaction },
  );
}

/**
 * Hard delete user
 */
async function hardDeleteUser(tenantId, userId, transaction) {
  const { User } = require("../models");

  await User.destroy({ where: { id: userId, tenantId }, transaction });
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
exports.rectifyData = async (tenantId, userId, field, value, actor = {}) => {
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

  const { User } = require("../models");
  const isEmail = field === "email";
  const newValue = isEmail ? normalizeRectifiedEmail(value) : value;
  let emailChange = null;

  // A-153: the change and its audit row are ONE transaction (the row was
  // written after the commit, and a failure to write it was only logged). The
  // row names the FIELD, never the new value: audit_logs is permanent and
  // never purged, so writing the value there put the very personal data being
  // corrected into a record that can never be corrected or erased.
  try {
    await db.transaction(async (transaction) => {
      const changes = { [field]: newValue };

      if (isEmail) {
        const user = await User.findOne({
          where: { id: userId, tenantId },
          attributes: ["id", "email", "firstName", "lastName"],
          transaction,
        });
        if (!user) {
          throw new AppError(404, "User not found");
        }
        // A-180: an address the account already has is not a change — no
        // re-verification, no mail.
        // `users.email` is NOT NULL.
        if (String(user.email).toLowerCase() !== newValue) {
          await assertEmailFree(User, userId, newValue, transaction);
          // A-180: the new address is unverified until the link sent to it
          // is followed (auth.service#activateAccount sets it back).
          changes.isEmailVerified = false;
          emailChange = { previous: user.email, firstName: user.firstName, lastName: user.lastName };
        }
      }

      const [count] = await User.update(changes, {
        where: { id: userId, tenantId },
        transaction,
      });
      if (count === 0) {
        throw new AppError(404, "User not found");
      }

      await auditService.logAction(
        {
          tenantId,
          userId, // self-service: the subject is the actor
          action: "UPDATE",
          resourceType: "User",
          resourceId: userId,
          changes: {
            operation: "GDPR_RECTIFICATION",
            fields: [field],
            ...(emailChange ? { emailVerificationReset: true } : {}),
          },
          ipAddress: actor.ipAddress || null,
          userAgent: actor.userAgent || null,
        },
        { transaction },
      );
    });
  } catch (err) {
    // A-180: the unique index is the last word under a race between the
    // pre-check and the write — still a 409, never a 500.
    if (err && err.name === "SequelizeUniqueConstraintError") {
      throw new AppError(409, EMAIL_IN_USE);
    }
    throw err;
  }

  if (emailChange) {
    await sendEmailChangeMail(userId, newValue, emailChange);
  }

  logger.info("Personal data rectified", { tenantId, userId, field });
  return {
    rectified: true,
    field,
    ...(emailChange ? { emailVerificationRequired: true } : {}),
  };
};

/**
 * A-180 — the 409 a rectification to a taken address answers. It explains the
 * state and what to do; it names no account and no tenant. (`users.email` is
 * unique across the platform, so "taken" can mean another tenant's account —
 * the same disclosure `POST /auth/register` and user creation already make.)
 */
const EMAIL_IN_USE =
  "This email address is already in use by another account. Choose a different address; your current address is unchanged.";

/**
 * A rectified email, trimmed and lower-cased, or a 400 when it is not an
 * address. The model's `isEmail` validator would otherwise throw a
 * SequelizeValidationError inside the transaction — a 500.
 *
 * @param {*} value - the requested address
 * @returns {string} the normalised address
 */
function normalizeRectifiedEmail(value) {
  const Joi = require("joi");
  const normalised = typeof value === "string" ? value.trim().toLowerCase() : value;
  const { error } = Joi.string().email({ tlds: { allow: false } }).max(255).required().validate(normalised);
  if (error) {
    throw new AppError(400, "email must be a valid email address");
  }
  return normalised;
}

/**
 * Refuse (409) an address another account already holds, compared without
 * case — the check user.service makes before creating or editing a user. The
 * lookup is `unscoped` and crosses tenants on purpose: the unique index it
 * anticipates is global, and a soft-deleted account still holds its address.
 *
 * @param {object} User - the User model
 * @param {string} userId - the subject, excluded
 * @param {string} email - the normalised address
 * @param {object} transaction - the rectification's transaction
 * @returns {Promise<void>}
 */
async function assertEmailFree(User, userId, email, transaction) {
  const { where, fn, col } = require("sequelize");
  const taken = await User.unscoped().findOne({
    where: {
      [Op.and]: [
        where(fn("lower", col("email")), email),
        { id: { [Op.ne]: userId } },
      ],
    },
    attributes: ["id"],
    paranoid: false,
    skipTenantScope: true,
    transaction,
  });
  if (taken) {
    throw new AppError(409, EMAIL_IN_USE);
  }
}

/**
 * After the commit: a verification link to the NEW address (the activation
 * link registration sends — auth.service#activateAccount marks it verified),
 * and a notice to the PREVIOUS one, so a change the owner did not make is
 * seen. Mail is best-effort, as at registration: a queue failure is logged,
 * and the change — already committed and audited — stands.
 *
 * @param {string} userId - the subject
 * @param {string} email - the new address
 * @param {{previous: string, firstName: string, lastName: string}} change
 * @returns {Promise<void>}
 */
async function sendEmailChangeMail(userId, email, { previous, firstName, lastName }) {
  const { generatePurposeToken } = require("../utils/jwt.util");
  const {
    queueActivationEmail,
    queueNotificationEmail,
  } = require("./emailQueue.service");
  const origin = (process.env.FRONTEND_URL || process.env.HOST_URL || "").replace(/\/+$/, "");

  try {
    const token = generatePurposeToken({ id: userId }, "activation");
    await queueActivationEmail({
      email,
      firstName,
      lastName,
      activationLink: `${origin}/activation?token=${token}`,
    });
    await queueNotificationEmail({
      email: previous,
      firstName,
      title: "Your email address was changed",
      message:
        "The email address on your account was changed. If you did not make this change, contact your administrator.",
    });
  } catch (err) {
    logger.warn("Email-change mail could not be queued", { userId, error: err.message });
  }
}

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
