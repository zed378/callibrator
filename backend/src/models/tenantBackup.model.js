/**
 * TenantBackup Model
 *
 * Tracks tenant database backup operations and schedules.
 */

// Backup status constants
const STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  DELETED: "deleted",
  RESTORING: "restoring",
  RESTORED: "restored",
  DELETING: "deleting",
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
        onDelete: "CASCADE",
      },
      // Backup details
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
   * @returns {object} The updated TenantBackup instance
   */
  TenantBackup.updateStatus = async (id, updates, models = null) => {
    const updateData = { ...updates };
    if (updates.status) {
      updateData.status = updates.status;
    }
    if (updates.filePath) {
      updateData.backupPath = updates.filePath;
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

    return TenantBackup.findByPk(id).then((backup) => {
      if (!backup) {
        throw new Error(`Backup with id ${id} not found`);
      }
      return backup.update(updateData);
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
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  // Attach constants to the model
  TenantBackup.STATUS = STATUS;
  TenantBackup.BACKUP_TYPES = BACKUP_TYPES;
  TenantBackup.DEFAULT_RETENTION_DAYS = DEFAULT_RETENTION_DAYS;

  return TenantBackup;
};

module.exports = defineModel;
