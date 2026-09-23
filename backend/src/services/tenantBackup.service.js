const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const moment = require("moment");

// Simplified tenant backup service - removed deprecated models (TenantSettings, TenantRoles, TenantFeatures, TenantAuditLog, UserPermissions)
const { TenantBackup, Tenant, Users, AuditLog } = require("../models");
// Sequelize helpers come from the package directly (not the models barrel) so
// they are available even when `../models` is mocked in unit tests.
const Sequelize = require("sequelize");
const { Op } = Sequelize;
const { logger } = require("../middlewares/activityLog.middleware");
const {
  AppError,
  ConflictError,
  InternalServerError,
} = require("../utils/appError.util");
const { USER_STATUS } = require("../constants");
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

/* ------------------------------------------------------------------ */
/* RESTORE                                                            */
/* ------------------------------------------------------------------ */

/**
 * The fields a restore may take from a backup archive when it CREATES an
 * account.
 *
 * A backup file is caller-supplied data (D-02): the previous implementation
 * spread the payload row straight into `bulkCreate`, so a crafted archive could
 * set `password`, `mfaSecret`, `webauthn*`, `isDeleted` — or `tenantId`, which
 * is how it wrote authenticating rows into a tenant it named itself. Nothing
 * outside this list is ever read from the file; `tenantId` is stamped
 * server-side from the backup row, and the credential fields are set by this
 * service, never by the archive.
 */
const RESTORE_CREATE_FIELDS = [
  "username",
  "email",
  "firstName",
  "lastName",
  "phone",
  "avatarUrl",
  "roleId",
];

/**
 * The fields a restore may write onto an account that ALREADY EXISTS.
 *
 * Narrower than the create list on purpose. `username` and `email` are the
 * natural key the row was matched on, so rewriting them is meaningless.
 * `roleId`, `isActive` and `status` are privilege state: a file that could
 * raise the role of a live, active account would be a privilege-escalation
 * primitive, which is the abuse D-02 describes. A restore updates the profile;
 * it does not re-grant access.
 */
const RESTORE_UPDATE_FIELDS = ["firstName", "lastName", "phone", "avatarUrl"];

/** Columns a backed-up user row must carry before it can be written at all. */
const REQUIRED_BACKUP_USER_FIELDS = [
  "username",
  "email",
  "firstName",
  "lastName",
];

/**
 * Copy only the named fields out of an untrusted object.
 * A field that is absent or null is left out so the model default applies.
 */
function pickFields(source, fields) {
  const picked = {};
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) {
      picked[field] = source[field];
    }
  }
  return picked;
}

/**
 * A credential no password can satisfy.
 *
 * `users.password` is NOT NULL, and the export deliberately omits the hash
 * (`exportTenantData` excludes it), so a restore has no hash to write. It must
 * therefore write something that cannot be logged in with: this value is not a
 * bcrypt hash, so `bcrypt.compare` returns false for every candidate. Combined
 * with `isActive: false` the account exists, is visible to an administrator,
 * and can only be entered after an administrator sets a real password — it is
 * never left with a guessable credential, and never left absent altogether.
 */
function unusableCredential() {
  return `!restore-reset-required:${crypto.randomBytes(24).toString("hex")}`;
}

/**
 * Decide whether this archive may be restored into this tenant at all.
 *
 * Every refusal here is a 409 carrying a state explanation that names the
 * problem, per the status-code table: the request is well formed and the caller
 * is permitted, but the backup and the target tenant are in states that cannot
 * be reconciled. Reporting these as a 500 would hide a design gap behind a
 * stack trace. None of these refusals touches a row, and none of them marks the
 * backup FAILED, because nothing was attempted.
 *
 * @param {object} args - the restore being validated
 * @param {string} args.backupId - the backup being restored
 * @param {object} args.backup - the backup row (server-side truth)
 * @param {object} args.data - the parsed archive payload (untrusted)
 * @param {string|null} args.targetTenantId - the tenant that owns the backup row
 * @returns {void}
 */
function assertRestorable({ backupId, backup, data, targetTenantId }) {
  if (!targetTenantId) {
    throw new ConflictError(
      `Backup ${backupId} has no owning tenant recorded, so there is no tenant to restore it into. ` +
        "A restore always targets the tenant that owns the backup row; the tenant named inside the archive is never used.",
    );
  }

  if (!data.metadata || !data.tenant) {
    throw new ConflictError(
      `Backup ${backupId} cannot be restored: its archive is missing the ` +
        `${!data.metadata ? "metadata" : "tenant"} section, so there is nothing to reconcile against.`,
    );
  }

  // The archive names a tenant. So does the backup row. When they disagree the
  // archive is the one that must be refused — the alternative is writing rows
  // into whatever tenant a file names, which is exactly D-02.
  if (data.tenant.id !== targetTenantId) {
    throw new ConflictError(
      `Backup ${backupId} belongs to tenant ${targetTenantId}, but its archive was taken from tenant ${data.tenant.id}. ` +
        "A backup can only be restored into the tenant that owns it; nothing has been written.",
    );
  }

  if (data.users !== undefined && !Array.isArray(data.users)) {
    throw new ConflictError(
      `Backup ${backupId} cannot be restored: its archive has a "users" section that is not a list.`,
    );
  }

  const backupType = data.metadata.backupType || backup.backupType;
  if (
    backupType === TenantBackup.BACKUP_TYPES.FULL &&
    !Array.isArray(data.users)
  ) {
    throw new ConflictError(
      `Backup ${backupId} is recorded as a "full" backup but its archive carries no "users" section. ` +
        'A "full" tenant backup contains the tenant row and its user accounts and nothing else — ' +
        "no devices, calibrations, certificates, attachments or stock — so with the users missing there is nothing left in it to restore.",
    );
  }

  for (const [index, user] of (data.users || []).entries()) {
    const missing = REQUIRED_BACKUP_USER_FIELDS.filter((field) => !user[field]);
    if (missing.length > 0) {
      throw new ConflictError(
        `Backup ${backupId} cannot be restored: user entry ${index} is missing ${missing.join(", ")}. ` +
          "A user row is matched and written by these fields, so an entry without them cannot be reconciled; nothing has been written.",
      );
    }
  }
}

/**
 * Reconcile the backed-up users into the target tenant. Additive by design.
 *
 * WHAT A RESTORE MEANS FOR A USER PRESENT IN BOTH the archive and the tenant:
 *   - `mergeData: false` (the default, "restore"): the live row is KEPT and its
 *     profile fields are updated from the backup. Its credential, its role and
 *     its active/suspended state are left exactly as they are.
 *   - `mergeData: true` ("merge"): the live row is left completely untouched. A
 *     merge only adds accounts the tenant does not have.
 *
 * WHAT NEVER HAPPENS, in either mode:
 *   - No account is deleted. An account created after the backup was taken —
 *     the case that made this path destructive (S-02) — is not in the archive,
 *     is therefore never matched, and survives untouched. It is counted as
 *     `retained` so the operator can see what was not restored over.
 *   - No live password is overwritten. The export has no hashes to restore.
 *   - A soft-deleted account matching a backed-up natural key is NOT revived.
 *     Reviving an account an administrator deleted is a grant of access and an
 *     owner decision, not a side effect of a restore. It is counted as
 *     `skippedDeleted`. (It also still holds the globally unique
 *     `username`/`email`, so creating alongside it would fail the constraint.)
 *
 * @param {object} args - the reconciliation inputs
 * @param {Array<object>} args.users - the backed-up user rows (untrusted)
 * @param {string} args.targetTenantId - the tenant every row is stamped with
 * @param {boolean} args.mergeData - true to add only, false to also update profiles
 * @param {object} args.transaction - the enclosing transaction
 * @returns {Promise<{created: number, updated: number, unchanged: number, skippedDeleted: number}>} per-account outcome counts
 */
async function reconcileUsers({
  users,
  targetTenantId,
  mergeData,
  transaction,
}) {
  const outcome = { created: 0, updated: 0, unchanged: 0, skippedDeleted: 0 };

  for (const user of users) {
    // The natural key. `Op` here is the STATIC operator set from the sequelize
    // package (imported at the top of this file). The previous merge branch
    // read `sequelize.Op.or` off a Sequelize INSTANCE, where `.Op` is
    // undefined, so it threw a TypeError before touching a row — the merge path
    // had never run.
    //
    // Unscoped and non-paranoid on purpose: the default scope hides `isDeleted`
    // rows and paranoid hides `deletedAt` rows, and both still hold the
    // globally unique username/email. They have to be seen in order to be
    // skipped.
    const live = await Users.unscoped().findOne({
      where: {
        tenantId: targetTenantId,
        [Op.or]: [{ username: user.username }, { email: user.email }],
      },
      paranoid: false,
      transaction,
    });

    if (!live) {
      await Users.create(
        {
          ...pickFields(user, RESTORE_CREATE_FIELDS),
          // Stamped server-side from the backup row. Whatever tenant the
          // archive names is irrelevant (D-02).
          tenantId: targetTenantId,
          // The archive has no hash, so the account is created in a state that
          // forces an administrator reset rather than in one anyone can
          // authenticate into.
          password: unusableCredential(),
          isActive: false,
          status: USER_STATUS.INACTIVE,
          isEmailVerified: false,
          isDeleted: false,
        },
        { transaction },
      );
      outcome.created += 1;
      continue;
    }

    if (live.isDeleted || live.deletedAt) {
      outcome.skippedDeleted += 1;
      continue;
    }

    if (mergeData) {
      outcome.unchanged += 1;
      continue;
    }

    await live.update(pickFields(user, RESTORE_UPDATE_FIELDS), { transaction });
    outcome.updated += 1;
  }

  return outcome;
}

/**
 * Restore a backup into the tenant that owns it.
 *
 * This is a non-destructive reconciliation, not a replace. See
 * `reconcileUsers` for what a restore means for each account, and
 * `assertRestorable` for the states that are refused with a 409.
 *
 * @param {object} args - the restore request
 * @param {string} args.backupId - the backup to restore
 * @param {string} args.restoredById - the acting user, for the audit row
 * @param {boolean} [args.mergeData] - true to add only, false to also update profiles
 * @param {object} args.models - the request-scoped models bag
 * @returns {Promise<object>} the response envelope
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
        required: false,
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

  // Server-side truth for where this restore may write: the tenant that owns
  // the backup row, never `data.tenant.id` from the archive.
  const targetTenantId = backup.tenantId || backup.tenant?.id || null;

  let data;
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
      throw new ConflictError(
        `Backup ${backupId} cannot be restored: its archive contains no tenant data file. Nothing has been written.`,
      );
    }

    const dataStr = await extracted.files[dataFile].async("string");
    data = JSON.parse(dataStr);

    assertRestorable({ backupId, backup, data, targetTenantId });
  } catch (error) {
    // A refusal is a state explanation about the backup, not a failure of this
    // restore: the backup row stays COMPLETED and the caller gets the 409
    // unchanged. Anything else really is a failure to read the archive.
    if (error instanceof AppError) {
      throw error;
    }

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

  // Update backup status to restoring — only now, once the archive is known to
  // be restorable into this tenant.
  await TenantBackup.updateStatus(
    backupId,
    {
      status: TenantBackup.STATUS.RESTORING,
    },
    models,
  );

  try {
    const backedUpUsers = data.users || [];

    // Get the transaction from models parameter for consistency
    const sequelize = models.sequelize || require("../models").sequelize;

    // Start transaction
    const transaction = await sequelize.transaction();

    try {
      const outcome = await reconcileUsers({
        users: backedUpUsers,
        targetTenantId,
        mergeData,
        transaction,
      });

      // Accounts the tenant has that the archive does not. They are left alone;
      // the count is reported so a restore cannot silently look like a replace.
      const liveUserCount = await Users.count({
        where: { tenantId: targetTenantId },
        transaction,
      });
      const retained = Math.max(
        liveUserCount - (outcome.created + outcome.updated + outcome.unchanged),
        0,
      );

      const recordsProcessed = backedUpUsers.length;

      // Every mutation writes an audit row, inside the same transaction.
      await AuditLog.create(
        {
          tenantId: targetTenantId,
          userId: restoredById || null,
          action: "RESTORE",
          resourceType: "TenantBackup",
          resourceId: backupId,
          changes: {
            mergeData,
            recordsProcessed,
            ...outcome,
            retained,
          },
        },
        { transaction },
      );

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
            ...outcome,
            retained,
          },
        },
        models,
      );

      logger.info("Tenant backup restored", {
        backupId,
        targetTenantId,
        recordsProcessed,
        restoredById,
        ...outcome,
        retained,
      });

      return {
        success: true,
        status: 200,
        message: "Backup restored successfully",
        data: {
          tenantId: targetTenantId,
          recordsProcessed,
          ...outcome,
          retained,
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
