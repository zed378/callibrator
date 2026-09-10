/**
 * PlanQuota Model
 *
 * Per-tenant quota limits per metric, used by usage/quota enforcement. A null
 * value would mean "unlimited"; a positive integer is the hard limit.
 */
const defineModel = (db, DataTypes) => {
  const PlanQuota = db.define(
    "PlanQuota",
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
      limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: "plan_quotas",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id", "metric"], unique: true }],
    },
  );

  PlanQuota.associate = (models) => {
    PlanQuota.belongsTo(models.Tenant, { foreignKey: "tenant_id", as: "tenant" });
  };

  return PlanQuota;
};

module.exports = defineModel;
