/**
 * UsageAlert Model
 *
 * Per-tenant usage-threshold alerts. When a monitored metric crosses the
 * configured threshold (per the comparison operator), notifications are sent on
 * the configured channels.
 */
const defineModel = (db, DataTypes) => {
  const UsageAlert = db.define(
    "UsageAlert",
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
      metricName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      threshold: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      comparison: {
        type: DataTypes.ENUM("gte", "lte", "eq", "gt", "lt"),
        allowNull: false,
        defaultValue: "gte",
      },
      notificationChannels: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ["email"],
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
        defaultValue: "",
      },
    },
    {
      tableName: "usage_alerts",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["metric_name"] }],
    },
  );

  UsageAlert.associate = (models) => {
    UsageAlert.belongsTo(models.Tenant, { foreignKey: "tenant_id", as: "tenant" });
  };

  return UsageAlert;
};

module.exports = defineModel;
