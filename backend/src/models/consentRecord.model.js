/**
 * ConsentRecord Model (GDPR consent management)
 *
 * Immutable-ish record of a data subject's consent decisions per processing
 * purpose. A withdrawal is recorded by flipping status to "withdrawn" and
 * stamping withdrawnAt (the granting row is retained for the audit history).
 */
const defineModel = (db, DataTypes) => {
  const ConsentRecord = db.define(
    "ConsentRecord",
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      // Consent purpose/category, e.g. analytics|marketing|functional|necessary
      purpose: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      version: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "1.0",
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("granted", "withdrawn"),
        allowNull: false,
        defaultValue: "granted",
      },
      consentedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      withdrawnAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "consent_records",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["user_id"] },
        { fields: ["purpose"] },
      ],
    },
  );

  ConsentRecord.associate = (models) => {
    ConsentRecord.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    ConsentRecord.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  return ConsentRecord;
};

module.exports = defineModel;
