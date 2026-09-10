/**
 * DataRetentionPolicy Model
 *
 * Declares how long a given entity type is retained before purge. A null
 * tenantId denotes a global/default policy; a set tenantId is a per-tenant
 * override.
 */
const defineModel = (db, DataTypes) => {
  const DataRetentionPolicy = db.define(
    "DataRetentionPolicy",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: true, // null = global default policy
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      // Entity/table the policy applies to, e.g. AuditLog, Notification, Session
      entityType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      retentionDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 365,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "data_retention_policies",
      timestamps: true,
      underscored: true,
      indexes: [{ fields: ["tenant_id"] }, { fields: ["is_active"] }],
    },
  );

  DataRetentionPolicy.associate = (models) => {
    DataRetentionPolicy.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
  };

  return DataRetentionPolicy;
};

module.exports = defineModel;
