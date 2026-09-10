const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class WorkflowStep extends Model {
    static associate(models) {
      WorkflowStep.belongsTo(models.Workflow, {
        foreignKey: "workflowId",
        as: "workflow",
        onDelete: "CASCADE",
      });
      WorkflowStep.belongsTo(models.Role, {
        foreignKey: "roleId",
        as: "role",
        onDelete: "RESTRICT",
      });
    }
  }

  WorkflowStep.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      workflowId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "workflows",
          key: "id",
        },
      },
      stepOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "roles",
          key: "id",
        },
      },
      requiredApprovals: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
    },
    {
      sequelize,
      modelName: "WorkflowStep",
      tableName: "workflow_steps",
      timestamps: true,
      underscored: true,
    }
  );

  return WorkflowStep;
};
