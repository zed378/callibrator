/**
 * ApiKey Model
 *
 * Tenant-scoped API keys / service accounts. The full key is shown only once at
 * creation; only a SHA-256 hash + a short display prefix are stored. Keys carry
 * scopes ("<resource>:<read|write|*>" or "*") enforced by dynamicAccess.
 */

// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const { jsonShape } = require("../utils/jsonShape.util");
const defineModel = (db, DataTypes) => {
  const ApiKey = db.define(
    "ApiKey",
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
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Short, non-secret display prefix (e.g. "cbk_1a2b3c").
      keyPrefix: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      // SHA-256 hex of the full key. Looked up on authentication.
      keyHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      // Lower-case "<menu slug>:<read|write>" strings, e.g. ["equipment:read", "certificate:write"].
      // Shape enforced on write by apiKey.service#assertScopes (A-27): a known slug,
      // read or write, and NO wildcard — the "*" / "*:read" forms this comment used
      // to show are refused (D-27).
      scopes: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("ApiKey.scopes") },
        allowNull: false,
        defaultValue: [],
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdBy: {
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
    },
    {
      tableName: "api_keys",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["key_hash"], unique: true },
        { fields: ["is_deleted"] },
      ],
      defaultScope: { where: { is_deleted: false } },
      scopes: { includeDeleted: { where: null } },
    },
  );

  ApiKey.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  ApiKey.associate = (models) => {
    ApiKey.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "CASCADE" });
  };

  return ApiKey;
};

module.exports = defineModel;
