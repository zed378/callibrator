/**
 * TenantBackup Model
 *
 * Tracks tenant database backup operations and schedules.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from tenantBackup.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type FindOptions,
  type InstanceUpdateOptions,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
  type Transaction,
  type WhereOptions,
} from "sequelize";
import { jsonShape, type TenantBackupMetadata } from "../utils/jsonShape.util";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

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
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  DELETED: "deleted",
} as const;

// Backup type constants
const BACKUP_TYPES = {
  FULL: "full",
  USER_ONLY: "user_only",
} as const;

// Default retention in days
const DEFAULT_RETENTION_DAYS = 30;

/** What createBackup reads from its argument. */
interface CreateBackupData {
  tenantId: TenantId;
  name?: string | null;
  description?: string | null;
  backupType?: string | null;
  retentionDays?: number | null;
  tag?: string | null;
  createdById?: UserId | null;
}

/** What updateStatus reads; any other key the caller passes is applied too, as before. */
interface BackupStatusUpdates {
  status?: (typeof STATUS)[keyof typeof STATUS];
  fileSize?: number | string | null;
  recordCount?: number | null;
  checksum?: string | null;
  errorMessage?: string | null;
  restoredAt?: Date | null;
  retentionDays?: number | null;
  [key: string]: unknown;
}

/** getTenantBackups' filters. */
interface TenantBackupListOptions {
  // P9-20: `undefined` admitted on each filter, as a query string gives it (type-only).
  tenantId?: TenantId | undefined;
  status?: (typeof STATUS)[keyof typeof STATUS] | undefined;
  backupType?: string | undefined;
  tag?: string | undefined;
  limit?: number | string | undefined;
  offset?: number | string | undefined;
}

/** A TenantBackup row (attributes, included associations, instance methods). Types only: emits nothing. */
interface TenantBackup extends Model<
  InferAttributes<TenantBackup>,
  InferCreationAttributes<TenantBackup>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  /** A-363: the operator's label (required by the create route; NULL on rows written before migration 0108). */
  name: string | null;
  /** A-363: the operator's optional description. */
  description: string | null;
  backupPath: string | null;
  /** BIGINT: node-postgres returns it as a string. */
  size: string | number | null;
  status: CreationOptional<(typeof STATUS)[keyof typeof STATUS] | null>;
  cronExpression: string | null;
  retentionDays: CreationOptional<number | null>;
  backupType: string | null;
  tag: string | null;
  filePath: string | null;
  /** BIGINT: node-postgres returns it as a string. */
  fileSize: string | number | null;
  recordCount: number | null;
  errorMessage: string | null;
  restoredAt: Date | null;
  expiresAt: Date | null;
  /** JSON, D-27 shape `TenantBackup.metadata`. */
  metadata: TenantBackupMetadata | null;
  createdBy: UserId | null;
  deletedBy: UserId | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  creator?: NonAttribute<ModelInstance<"User">>;
}

interface TenantBackupStatics {
  associate: (models: Models) => void;
  createBackup: (
    data: CreateBackupData,
    models?: unknown,
  ) => Promise<TenantBackup>;
  updateStatus: (
    id: string,
    updates: BackupStatusUpdates,
    models?: unknown,
    options?: { transaction?: Transaction },
  ) => Promise<TenantBackup>;
  getTenantBackups: (
    opts?: TenantBackupListOptions,
    models?: unknown,
  ) => Promise<{ count: number; rows: TenantBackup[] }>;
  getLatestBackup: (
    tenantId: TenantId,
    models?: unknown,
  ) => Promise<TenantBackup | null>;
  hasValidBackups: (tenantId: TenantId, models?: unknown) => Promise<boolean>;
  STATUS: typeof STATUS;
  BACKUP_TYPES: typeof BACKUP_TYPES;
  DEFAULT_RETENTION_DAYS: typeof DEFAULT_RETENTION_DAYS;
}

type DefineTenantBackup = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<TenantBackup, TenantBackupStatics>;

/** Define the TenantBackup model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineTenantBackup = (db, DataTypes) => {
  const TenantBackup = initModel<TenantBackup, TenantBackupStatics>(
    class extends Model {},
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
      // A-363 (migration 0108): what the operator named the backup. The create
      // route requires `name` and accepts `description`; neither was an
      // attribute, so Sequelize dropped both on insert and the backup page
      // listed blank names. Nullable: rows written before 0108 have neither.
      name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // Backup details
      // LEGACY: no longer written (S-32). updateStatus used to copy filePath
      // here, and an absolute path longer than 255 characters (a long
      // APP_STORAGE_PATH) failed the whole COMPLETED update with "value too
      // long". `filePath` (VARCHAR(500)) is the path of record; readers fall
      // back to this column for rows written before the fix. TEXT since
      // migration 0087 (ADR-080), so the column is no longer a 255-character
      // trap for a future writer.
      backupPath: {
        type: DataTypes.TEXT,
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
        validate: { shape: jsonShape("TenantBackup.metadata") },
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
      modelName: "TenantBackup",
      sequelize: db,
    },
  );

  /**
   * Static method to create a new backup record.
   * @param {Object} data - Backup data
   * @param {object} models - The models object
   * @returns {object} The created TenantBackup instance
   */
  TenantBackup.createBackup = async (
    data: CreateBackupData,
    // The barrel, passed by callers (as built); this static does not read it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept: callers pass it, and the arity is part of the as-built API
    _models: unknown = null,
  ): Promise<TenantBackup> => {
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also falls back */
    return TenantBackup.create({
      tenantId: data.tenantId,
      // A-363: stored (they were dropped on insert before migration 0108).
      name: data.name || null,
      description: data.description || null,
      backupType: data.backupType || BACKUP_TYPES.FULL,
      retentionDays: data.retentionDays || DEFAULT_RETENTION_DAYS,
      tag: data.tag || null,
      createdBy: data.createdById || null,
      status: STATUS.PENDING,
    });
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  };

  /**
   * Static method to update backup status and optional fields.
   * @param {string} id - Backup ID
   * @param {Object} updates - Fields to update
   * @param {object} models - The models object
   * @param {{transaction?: object}} [options] - run inside this transaction
   * @returns {object} The updated TenantBackup instance
   */
  TenantBackup.updateStatus = async (
    id: string,
    updates: BackupStatusUpdates,
    // The barrel, passed by callers (as built); this static does not read it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept: callers pass it, and the arity is part of the as-built API
    _models: unknown = null,
    options: { transaction?: Transaction } = {},
  ): Promise<TenantBackup> => {
    // Every key the caller passed is kept (as built); the typed ones below are then set.
    const updateData: Record<string, unknown> = { ...updates };
    if (updates.status) {
      updateData["status"] = updates.status;
    }
    if (updates.fileSize) {
      updateData["size"] = updates.fileSize;
    }
    if (updates.recordCount !== undefined) {
      updateData["recordCount"] = updates.recordCount;
    }
    if (updates.checksum) {
      updateData["metadata"] = {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
        ...(updateData["metadata"] || {}),
        checksum: updates.checksum,
      };
    }
    if (updates.errorMessage) {
      updateData["errorMessage"] = updates.errorMessage;
    }
    if (updates.restoredAt) {
      updateData["restoredAt"] = updates.restoredAt;
    }

    // Calculate expiresAt if retentionDays is set
    if (updates.retentionDays) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + updates.retentionDays);
      updateData["expiresAt"] = expiresAt;
    }

    const { transaction } = options;
    // `transaction` stays undefined when absent (null would switch off the CLS transaction). Two option
    // objects, one per call, as before; each typed through a variable, then as the option.
    const findOptions: { transaction: Transaction | undefined } = {
      transaction,
    };
    return TenantBackup.findByPk(
      id,
      findOptions as FindOptions<InferAttributes<TenantBackup>>,
    ).then((backup) => {
      if (!backup) {
        throw new Error(`Backup with id ${id} not found`);
      }
      const updateOptions: { transaction: Transaction | undefined } = {
        transaction,
      };
      // The accumulated keys are the caller's update, as before: Sequelize applies the attributes among them.
      return backup.update(
        updateData as Partial<InferAttributes<TenantBackup>>,
        updateOptions as InstanceUpdateOptions<InferAttributes<TenantBackup>>,
      );
    });
  };

  /**
   * Static method to list a tenant's backups with optional filters.
   * @param {Object} opts - { tenantId, status?, backupType?, tag?, limit?, offset? }
   * @param {object} models - The models object
   * @returns {{ count: number, rows: object[] }}
   */
  TenantBackup.getTenantBackups = async (
    opts: TenantBackupListOptions = {},
    // The barrel, passed by callers (as built); this static does not read it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept: callers pass it, and the arity is part of the as-built API
    _models: unknown = null,
  ): Promise<{ count: number; rows: TenantBackup[] }> => {
    const { tenantId, status, backupType, tag, limit = 20, offset = 0 } = opts;

    const where: WhereOptions<InferAttributes<TenantBackup>> &
      Record<string, unknown> = { tenantId };
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
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      // String(): parseInt converts its argument with ToString, so this is the same parse.
      limit: parseInt(String(limit), 10),
      offset: parseInt(String(offset), 10),
    });
  };

  /**
   * Static method to get the latest backup for a tenant.
   * @param {string} tenantId - Tenant ID
   * @param {object} models - The models object
   * @returns {object|null} The latest TenantBackup instance or null
   */
  TenantBackup.getLatestBackup = async (
    tenantId: TenantId,
    // The barrel, passed by callers (as built); this static does not read it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept: callers pass it, and the arity is part of the as-built API
    _models: unknown = null,
  ): Promise<TenantBackup | null> => {
    return TenantBackup.findOne({
      where: { tenantId, status: STATUS.COMPLETED },
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit: 1,
    });
  };

  /**
   * Static method to check if tenant has valid backups.
   * @param {string} tenantId - Tenant ID
   * @param {object} models - The models object
   * @returns {boolean} True if valid backups exist
   */
  TenantBackup.hasValidBackups = async (
    tenantId: TenantId,
    // The barrel, passed by callers (as built); this static does not read it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept: callers pass it, and the arity is part of the as-built API
    _models: unknown = null,
  ): Promise<boolean> => {
    const count = await TenantBackup.count({
      where: { tenantId, status: STATUS.COMPLETED },
    });
    return count > 0;
  };

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  TenantBackup.associate = (models: Models): void => {
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

export = defineModel;
