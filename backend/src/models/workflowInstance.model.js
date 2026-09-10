const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class WorkflowInstance extends Model {
    static associate(models) {
      WorkflowInstance.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      WorkflowInstance.belongsTo(models.Workflow, {
        foreignKey: "workflowId",
        as: "workflow",
        onDelete: "CASCADE",
      });
      WorkflowInstance.hasMany(models.WorkflowAction, {
        foreignKey: "instanceId",
        as: "actions",
        onDelete: "CASCADE",
      });
    }
  }

  WorkflowInstance.init(
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
      workflowId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "workflows",
          key: "id",
        },
      },
      resourceId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED", "CANCELLED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      currentStepOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
    },
    {
      sequelize,
      modelName: "WorkflowInstance",
      tableName: "workflow_instances",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );

  return WorkflowInstance;
};
