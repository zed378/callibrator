/**
 * DsarRequest Model (Data Subject Access Request)
 *
 * Tracks GDPR data-subject requests (export / erasure / rectification /
 * restriction) as asynchronous, auditable work items.
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const { jsonShape } = require("../utils/jsonShape.util");
const defineModel = (db, DataTypes) => {
  const DsarRequest = db.define(
    "DsarRequest",
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
      type: {
        type: DataTypes.ENUM(
          "export",
          "erasure",
          "rectification",
          "restriction",
        ),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          "pending",
          "in_progress",
          "completed",
          "rejected",
        ),
        allowNull: false,
        defaultValue: "pending",
      },
      details: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("DsarRequest.details") },
        allowNull: true,
      },
      requestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "dsar_requests",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["user_id"] },
        { fields: ["status"] },
      ],
    },
  );

  DsarRequest.associate = (models) => {
    DsarRequest.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    DsarRequest.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
      onDelete: "RESTRICT",
    });
  };

  return DsarRequest;
};

module.exports = defineModel;
