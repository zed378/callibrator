const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Workflow extends Model {
    static associate(models) {
      Workflow.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      Workflow.hasMany(models.WorkflowStep, {
        foreignKey: "workflowId",
        as: "steps",
        onDelete: "CASCADE",
      });
      Workflow.hasMany(models.WorkflowInstance, {
        foreignKey: "workflowId",
        as: "instances",
        onDelete: "CASCADE",
      });
    }
  }

  Workflow.init(
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
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      resourceType: {
        type: DataTypes.ENUM("Certificate", "StockTransfer", "MaintenanceWorkOrder"),
        allowNull: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: "Workflow",
      tableName: "workflows",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );

  return Workflow;
};
