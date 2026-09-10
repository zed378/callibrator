/**
 * ESignatureRecord Model — Compliance logging
 *
 * Immutable audit trail of all electronic signatures to comply with 21 CFR Part 11.
 * Captures user intent, authentication method, document hash, IP address, and timestamp.
 */

const defineModel = (db, DataTypes) => {
  const ESignatureRecord = db.define(
    "ESignatureRecord",
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
      entityType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: "The type of entity being signed (e.g., Certificate, SOPDocument)",
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: "The UUID of the entity being signed",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      action: {
        type: DataTypes.ENUM("approve", "sign", "revoke"),
        allowNull: false,
      },
      meaning: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: "User's intent or meaning for the signature",
      },
      authMethod: {
        type: DataTypes.ENUM("password", "mfa", "sso"),
        allowNull: false,
      },
      documentHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Cryptographic hash (e.g. SHA-256) of the document at time of signature",
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "e_signature_records",
      timestamps: false, // Immutable, no updatedAt or paranoid
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["entity_type", "entity_id"] },
        { fields: ["user_id"] },
      ],
    },
  );

  ESignatureRecord.associate = (models) => {
    ESignatureRecord.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    // Removed Certificate association since it's now polymorphic
    ESignatureRecord.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  return ESignatureRecord;
};

module.exports = defineModel;
