/**
 * Attachment Model
 *
 * Tenant-scoped file/document registry. Any resource (certificate, device,
 * work order, etc.) can link files here via (resourceType, resourceId). Powers
 * the File/Document module and the tenant storage-quota accounting.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from attachment.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import {
  ATTACHMENT_RESOURCE_TYPES,
  isAttachmentResourceType,
} from "../constants/attachmentResources";
import type { TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Attachment row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Attachment extends Model<
  InferAttributes<Attachment>,
  InferCreationAttributes<Attachment>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  /** D-22: one of constants/attachmentResources (ignoring case), validated when written. A STRING column, so a legacy row may hold another value. */
  resourceType: CreationOptional<string>;
  resourceId: string | null;
  fileName: string;
  originalName: string;
  folder: CreationOptional<string>;
  storageKey: CreationOptional<string | null>;
  mimeType: string | null;
  /** BIGINT: node-postgres returns it as a string. */
  size: CreationOptional<string | number>;
  checksum: string | null;
  uploadedBy: UserId | null;
  isDeleted: CreationOptional<boolean>;
  filePurgedAt: CreationOptional<Date | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  uploader?: NonAttribute<ModelInstance<"User">>;

  softDelete(): Promise<Attachment>;
}

interface AttachmentStatics {
  associate: (models: Models) => void;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineAttachment = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Attachment, AttachmentStatics>;

/** Define the Attachment model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineAttachment = (db, DataTypes) => {
  const Attachment = initModel<Attachment, AttachmentStatics>(
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
      // Polymorphic link to the owning resource (nullable = standalone upload).
      // D-22 (ADR-083): one of constants/attachmentResources, ignoring case.
      // Validated when written, so a legacy row with another value can still
      // be soft-deleted (save() validates only the attributes it changes).
      resourceType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "generic",
        validate: {
          knownResourceType(value: unknown): void {
            if (!isAttachmentResourceType(value)) {
              throw new Error(
                `resourceType "${String(value)}" is not one of: ${ATTACHMENT_RESOURCE_TYPES.join(", ")}`,
              );
            }
          },
        },
      },
      resourceId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // Stored filename on disk (opaque, randomized by multer).
      fileName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Original filename supplied by the uploader (used on download).
      originalName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Folder (relative to the storage root) the file lives in.
      // LEGACY addressing: retained for rows uploaded before the pluggable
      // storage layer, and as the source path for the migration tool.
      folder: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "uploads/attachments",
      },
      // Pluggable-storage key: `t/<tenantId>/<domain>/<name>`. NULL for rows
      // that still live on the legacy folder/fileName disk path and have not
      // yet been migrated into the configured storage backend.
      storageKey: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        defaultValue: null,
      },
      mimeType: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      size: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      // SHA-256 of the file contents (integrity / dedup).
      checksum: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      uploadedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      // D-22 (ADR-083, migration 0088): when the deleted-file sweep removed
      // this soft-deleted row's bytes (or confirmed they were already gone).
      // NULL on every live row and on a deleted row still inside its window.
      filePurgedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      tableName: "attachments",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["resource_type", "resource_id"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "Attachment",
      sequelize: db,
    },
  );

  // Soft-delete: set the ATTRIBUTE (isDeleted) so save() persists it.
  Attachment.prototype.softDelete = async function (
    this: Attachment,
  ): Promise<Attachment> {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Attachment.associate = (models: Models): void => {
    Attachment.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    Attachment.belongsTo(models.User, {
      foreignKey: "uploadedBy",
      as: "uploader",
      onDelete: "SET NULL",
    });
  };

  return Attachment;
};

export = defineModel;
