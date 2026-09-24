/**
 * DataRetentionPolicy Model
 *
 * Declares how long a given entity type is retained before purge.
 *
 * A-121 (ADR-051 Q-10): this table is read by nothing. Its only reader was the
 * second purge engine in gdpr.service (`enforceDataRetention`), which has been
 * removed; the live engine is dataRetention.service over `tenant_settings`.
 * The table is kept, not dropped (dropping it needs its own migration), and a
 * tenant-less ("global") row can no longer be created through the model.
 * Rows that already have no tenant are inert: nothing reads them.
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
        // Nullable in the schema only because existing tenant-less rows must
        // not break a sync; the model-level `validate` below refuses new ones.
        allowNull: true,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
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
      validate: {
        // A-121 (ADR-051 Q-10): there is no global retention policy. The
        // platform default lives in code and the environment.
        policyIsPerTenant() {
          if (!this.tenantId) {
            throw new Error(
              "Retention policies are set per tenant; a global (tenant-less) policy cannot be created.",
            );
          }
        },
      },
    },
  );

  DataRetentionPolicy.associate = (models) => {
    DataRetentionPolicy.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
  };

  return DataRetentionPolicy;
};

module.exports = defineModel;
