/**
 * TenantBackup Model
 *
 * Tracks tenant database backup operations and schedules.
 */

// Backup status constants — EXACTLY the members of the column's ENUM below.
//
// S-32: this object used to carry three more — RESTORING, RESTORED and
// DELETING — that the `status` ENUM never had, and tenantBackup.service wrote
// them. On PostgreSQL every such write fails with `invalid input value for
// enum enum_tenant_backups_status`, so EVERY restore and EVERY HTTP delete of
// a tenant backup failed on a real database (proven on PG16, 2026-09-24);
// the unit tests mocked the model and never saw it. The service now expresses
// those states with ENUM members:
//   restoring -> IN_PROGRESS (claimed conditionally from COMPLETED)
//   restored  -> COMPLETED with `restoredAt` set
//   deleting  -> no intermediate state; DELETED + soft delete in one transaction
// tests/models/tenantBackup.status.s32.test.js keeps this object and the ENUM
// identical.
const STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  DELETED: "deleted",
};

// Backup type constants
const BACKUP_TYPES = {
  FULL: "full",
  USER_ONLY: "user_only",
};

// Default retention in days
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Define the TenantBackup model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
const defineModel = (db, DataTypes) => {
  const TenantBackup = db.define(
    "TenantBackup",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
      },
      // Backup details
      // LEGACY, VARCHAR(255): no longer written (S-32). updateStatus used to
      // copy filePath here, and an absolute path longer than 255 characters
      // (a long APP_STORAGE_PATH) failed the whole COMPLETED update with
      // "value too long". `filePath` (VARCHAR(500)) is the path of record;
      // readers fall back to this column for rows written before the fix.
      backupPath: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      size: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          "pending",
          "in_progress",
          "completed",
          "failed",
          "deleted",
        ),
        defaultValue: "pending",
      },
      // Schedule (for recurring backups)
      cronExpression: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      retentionDays: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
      },
      // Backup details
      backupType: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tag: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      filePath: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      fileSize: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      recordCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      restoredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Audit
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      deletedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
    },
    {
      tableName: "tenant_backups",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["status"] },
        { fields: ["created_at"] },
      ],
    },
  );

  /**
   * Static method to create a new backup record.
   * @param {Object} data - Backup data
   * @param {object} models - The models object
   * @returns {object} The created TenantBackup instance
   */
  TenantBackup.createBackup = async (data, models = null) => {
    return TenantBackup.create({
      tenantId: data.tenantId,
      name: data.name || null,
      description: data.description || null,
      backupType: data.backupType || BACKUP_TYPES.FULL,
      retentionDays: data.retentionDays || DEFAULT_RETENTION_DAYS,
      tag: data.tag || null,
      createdBy: data.createdById || null,
      status: STATUS.PENDING,
    });
  };

  /**
   * Static method to update backup status and optional fields.
   * @param {string} id - Backup ID
   * @param {Object} updates - Fields to update
   * @param {object} models - The models object
   * @param {{transaction?: object}} [options] - run inside this transaction
   * @returns {object} The updated TenantBackup instance
   */
  TenantBackup.updateStatus = async (id, updates, models = null, options = {}) => {
    const updateData = { ...updates };
    if (updates.status) {
      updateData.status = updates.status;
    }
    if (updates.fileSize) {
      updateData.size = updates.fileSize;
    }
    if (updates.recordCount !== undefined) {
      updateData.recordCount = updates.recordCount;
    }
    if (updates.checksum) {
      updateData.metadata = {
        ...(updateData.metadata || {}),
        checksum: updates.checksum,
      };
    }
    if (updates.errorMessage) {
      updateData.errorMessage = updates.errorMessage;
    }
    if (updates.restoredAt) {
      updateData.restoredAt = updates.restoredAt;
    }

    // Calculate expiresAt if retentionDays is set
    if (updates.retentionDays) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + updates.retentionDays);
      updateData.expiresAt = expiresAt;
    }

    const { transaction } = options;
    return TenantBackup.findByPk(id, { transaction }).then((backup) => {
      if (!backup) {
        throw new Error(`Backup with id ${id} not found`);
      }
      return backup.update(updateData, { transaction });
    });
  };

  /**
   * Static method to list a tenant's backups with optional filters.
   * @param {Object} opts - { tenantId, status?, backupType?, tag?, limit?, offset? }
   * @param {object} models - The models object
   * @returns {{ count: number, rows: object[] }}
   */
  TenantBackup.getTenantBackups = async (opts = {}, models = null) => {
    const { tenantId, status, backupType, tag, limit = 20, offset = 0 } = opts;

    const where = { tenantId };
    if (status) {
      where.status = status;
    }
    if (backupType) {
      where.backupType = backupType;
    }
    if (tag) {
      where.tag = tag;
    }

    return TenantBackup.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  };

  /**
   * Static method to get the latest backup for a tenant.
   * @param {string} tenantId - Tenant ID
   * @param {object} models - The models object
   * @returns {object|null} The latest TenantBackup instance or null
   */
  TenantBackup.getLatestBackup = async (tenantId, models = null) => {
    return TenantBackup.findOne({
      where: { tenantId, status: STATUS.COMPLETED },
      order: [["createdAt", "DESC"]],
      limit: 1,
    });
  };

  /**
   * Static method to check if tenant has valid backups.
   * @param {string} tenantId - Tenant ID
   * @param {object} models - The models object
   * @returns {boolean} True if valid backups exist
   */
  TenantBackup.hasValidBackups = async (tenantId, models = null) => {
    const count = await TenantBackup.count({
      where: { tenantId, status: STATUS.COMPLETED },
    });
    return count > 0;
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  TenantBackup.associate = (models) => {
    // TenantBackup -> Tenant
    TenantBackup.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // TenantBackup -> User (creator). createBackup, downloadBackup and the
    // getBackup controller all include `creator`, but the association was
    // never defined, so each of them threw "User is not associated to
    // TenantBackup!" against the real models (A-90; unit tests mocked the
    // models and never saw it). The column already exists: `created_by`.
    TenantBackup.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "creator",
    });
  };

  // Attach constants to the model
  TenantBackup.STATUS = STATUS;
  TenantBackup.BACKUP_TYPES = BACKUP_TYPES;
  TenantBackup.DEFAULT_RETENTION_DAYS = DEFAULT_RETENTION_DAYS;

  return TenantBackup;
};

module.exports = defineModel;
