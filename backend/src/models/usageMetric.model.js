/**
 * UsageMetric Model
 *
 * Time-bucketed per-tenant usage counters (api_calls, storage_bytes,
 * calibrations, ...). Aggregated by periodStart. Intentionally NOT underscored:
 * the metered-billing service's Postgres aggregation path queries the
 * "UsageMetrics" table with camelCase "tenantId"/"periodStart" columns, so the
 * model column names must match that shape.
 */
const defineModel = (db, DataTypes) => {
  const UsageMetric = db.define(
    "UsageMetric",
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
      metric: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      periodStart: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "UsageMetrics",
      timestamps: true,
      indexes: [
        { fields: ["tenantId", "metric", "periodStart"], unique: true },
        { fields: ["tenantId"] },
        { fields: ["periodStart"] },
      ],
    },
  );

  UsageMetric.associate = (models) => {
    UsageMetric.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant" });
  };

  return UsageMetric;
};

module.exports = defineModel;
