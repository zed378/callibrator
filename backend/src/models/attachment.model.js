/**
 * Attachment Model
 *
 * Tenant-scoped file/document registry. Any resource (certificate, device,
 * work order, etc.) can link files here via (resourceType, resourceId). Powers
 * the File/Document module and the tenant storage-quota accounting.
 */

const {
  ATTACHMENT_RESOURCE_TYPES,
  isAttachmentResourceType,
} = require("../constants/attachmentResources");

const defineModel = (db, DataTypes) => {
  const Attachment = db.define(
    "Attachment",
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
          knownResourceType(value) {
            if (!isAttachmentResourceType(value)) {
              throw new Error(`resourceType "${value}" is not one of: ${ATTACHMENT_RESOURCE_TYPES.join(", ")}`);
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
        where: { is_deleted: false },
      },
      scopes: {
        includeDeleted: { where: null },
      },
    },
  );

  // Soft-delete: set the ATTRIBUTE (isDeleted) so save() persists it.
  Attachment.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  Attachment.associate = (models) => {
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

module.exports = defineModel;
