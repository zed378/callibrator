// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its WorkflowInstance (scoped). Every query names instanceId.
// Held by tests/models/unscopedModels.d17.test.js.
// P9-10 (ADR-087 Amendments 7–8): converted from workflowAction.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  DataTypes,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `action` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WORKFLOW_ACTIONS = ["APPROVED", "REJECTED"] as const;

/** A WorkflowAction row (attributes, included associations, instance methods). Types only: emits nothing. */
interface WorkflowAction extends Model<
  InferAttributes<WorkflowAction>,
  InferCreationAttributes<WorkflowAction>
> {
  id: CreationOptional<string>;
  instanceId: string;
  stepId: string;
  userId: UserId | null;
  action: (typeof WORKFLOW_ACTIONS)[number];
  comments: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  instance?: NonAttribute<ModelInstance<"WorkflowInstance">>;
  step?: NonAttribute<ModelInstance<"WorkflowStep">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface WorkflowActionStatics {
  associate(models: Models): void;
}

type DefineWorkflowAction = (
  sequelize: Sequelize,
) => TypedModel<WorkflowAction, WorkflowActionStatics>;

/** Define the WorkflowAction model (a fresh class per call). */
const defineModel: DefineWorkflowAction = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class WorkflowActionModel extends Model {
    static associate(models: Models): void {
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

  const WorkflowAction = initModel<WorkflowAction, WorkflowActionStatics>(
    WorkflowActionModel,
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
        type: DataTypes.ENUM(...WORKFLOW_ACTIONS),
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
    },
  );

  return WorkflowAction;
};

export = defineModel;
