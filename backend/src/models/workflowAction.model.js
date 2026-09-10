const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class WorkflowAction extends Model {
    static associate(models) {
      WorkflowAction.belongsTo(models.WorkflowInstance, {
        foreignKey: "instanceId",
        as: "instance",
        onDelete: "CASCADE",
      });
      WorkflowAction.belongsTo(models.WorkflowStep, {
        foreignKey: "stepId",
        as: "step",
        onDelete: "CASCADE",
      });
      WorkflowAction.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        onDelete: "SET NULL",
      });
    }
  }

  WorkflowAction.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      instanceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "workflow_instances",
          key: "id",
        },
      },
      stepId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "workflow_steps",
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
        type: DataTypes.ENUM("APPROVED", "REJECTED"),
        allowNull: false,
      },
      comments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "WorkflowAction",
      tableName: "workflow_actions",
      timestamps: true,
      underscored: true,
    }
  );

  return WorkflowAction;
};
