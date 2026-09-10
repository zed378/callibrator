const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class MaintenanceWorkOrder extends Model {
    static associate(models) {
      MaintenanceWorkOrder.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      MaintenanceWorkOrder.belongsTo(models.CalibrationDevice, {
        foreignKey: "deviceId",
        as: "device",
        onDelete: "CASCADE",
      });
      MaintenanceWorkOrder.belongsTo(models.Vendor, {
        foreignKey: "vendorId",
        as: "vendor",
        onDelete: "SET NULL",
      });
      MaintenanceWorkOrder.belongsTo(models.User, {
        foreignKey: "assignedTo",
        as: "assignee",
        onDelete: "SET NULL",
      });
    }
  }

  MaintenanceWorkOrder.init(
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
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "calibration_devices",
          key: "id",
        },
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM("Preventative", "Breakdown", "Repair"),
        allowNull: false,
        defaultValue: "Preventative",
      },
      status: {
        type: DataTypes.ENUM("Open", "InProgress", "Completed", "Cancelled"),
        allowNull: false,
        defaultValue: "Open",
      },
      priority: {
        type: DataTypes.ENUM("Low", "Medium", "High", "Critical"),
        allowNull: false,
        defaultValue: "Medium",
      },
      vendorId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "vendors",
          key: "id",
        },
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "MaintenanceWorkOrder",
      tableName: "maintenance_work_orders",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return MaintenanceWorkOrder;
};
