// D-17 — NO tenant column, so the global tenant hooks never scope this model: belongs to a tenant THROUGH its Workflow (scoped). Every query names workflowId.
// Held by tests/models/unscopedModels.d17.test.js.
// P9-10 (ADR-087 Amendments 7–8): converted from workflowStep.model.js with no behaviour
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
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A WorkflowStep row (attributes, included associations, instance methods). Types only: emits nothing. */
interface WorkflowStep extends Model<
  InferAttributes<WorkflowStep>,
  InferCreationAttributes<WorkflowStep>
> {
  id: CreationOptional<string>;
  workflowId: string;
  stepOrder: number;
  roleId: string;
  requiredApprovals: CreationOptional<number>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  workflow?: NonAttribute<ModelInstance<"Workflow">>;
  role?: NonAttribute<ModelInstance<"Role">>;
}

interface WorkflowStepStatics {
  associate(models: Models): void;
}

type DefineWorkflowStep = (
  sequelize: Sequelize,
) => TypedModel<WorkflowStep, WorkflowStepStatics>;

/** Define the WorkflowStep model (a fresh class per call). */
const defineModel: DefineWorkflowStep = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class WorkflowStepModel extends Model {
    static associate(models: Models): void {
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

  const WorkflowStep = initModel<WorkflowStep, WorkflowStepStatics>(
    WorkflowStepModel,
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
    },
  );

  return WorkflowStep;
};

export = defineModel;
