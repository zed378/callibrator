/**
 * DsarRequest Model (Data Subject Access Request)
 *
 * Tracks GDPR data-subject requests (export / erasure / rectification /
 * restriction) as asynchronous, auditable work items.
 */
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
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
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
      foreignKey: "tenant_id",
      as: "tenant",
    });
    DsarRequest.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  return DsarRequest;
};

module.exports = defineModel;
