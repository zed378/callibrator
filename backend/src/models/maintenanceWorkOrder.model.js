const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class MaintenanceWorkOrder extends Model {
    static associate(models) {
      MaintenanceWorkOrder.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
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
        onDelete: "RESTRICT",
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
      // W-03 — true only for a work order the calibration scan created. At
      // most ONE such order per device may be open (Open/InProgress, not
      // soft-deleted): migration 0060's partial unique index, which is what
      // makes two concurrent scans create one work order, not two. The index
      // lives only in the migration — declared here, db.sync() would try to
      // build it before the migration adds this column on an existing DB.
      autoScheduled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
