/**
 * TenantKey Model — Per-tenant cryptographic key pairs
 *
 * Stores RSA (or other algorithm) key pairs used by the e-signature module.
 * The private key is stored ENCRYPTED at rest (AES-256) by the e-signature
 * service; this model never holds a plaintext private key. Tenant-scoped, so
 * the tenant-isolation hooks confine every query to the caller's tenant.
 */

const defineModel = (db, DataTypes) => {
  const TenantKey = db.define(
    "TenantKey",
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
      keyId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        comment: "Human-readable key identifier (key-<ts>-<rand>)",
      },
      keyType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "esignature",
      },
      algorithm: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "RS256",
      },
      publicKey: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      privateKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "AES-256 encrypted PEM (iv:ciphertext); never plaintext",
      },
    },
    {
      tableName: "tenant_keys",
      timestamps: true,
      paranoid: true,
      underscored: true,
      defaultScope: {
        // Never leak the encrypted private key on ordinary reads; the service
        // opts back in with `.scope(null)` / attributes when it needs it.
        attributes: { exclude: ["privateKey"] },
      },
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["key_id"], unique: true },
        { fields: ["key_type"] },
      ],
    },
  );

  TenantKey.associate = (models) => {
    TenantKey.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  return TenantKey;
};

module.exports = defineModel;
