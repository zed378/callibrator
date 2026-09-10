const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class AuditLog extends Model {
    static associate(models) {
      AuditLog.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      AuditLog.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        onDelete: "SET NULL", // Keep the log even if user is deleted
      });
    }
  }

  AuditLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "tenants",
          key: "id",
        },
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
      action: {
        type: DataTypes.ENUM("CREATE", "UPDATE", "DELETE", "LOGIN", "APPROVE", "EXPORT"),
        allowNull: false,
      },
      resourceType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      resourceId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      changes: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: "Stores { before: {}, after: {} } snapshots of the record",
      },
      ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AuditLog",
      tableName: "audit_logs",
      timestamps: true,
      updatedAt: false, // Audit logs are immutable, they shouldn't be updated
      underscored: true,
    },
  );

  return AuditLog;
};
