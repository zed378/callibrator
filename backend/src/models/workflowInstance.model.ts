// P9-10 (ADR-087 Amendments 7–8): converted from workflowInstance.model.js with no behaviour
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
import type { TenantId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";
import { WORKFLOW_INSTANCE_STATUSES } from "@callibrator/contracts/states";

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
// P9-05: WORKFLOW_INSTANCE_STATUSES is the one list in @callibrator/contracts/states.

/** A WorkflowInstance row (attributes, included associations, instance methods). Types only: emits nothing. */
interface WorkflowInstance extends Model<
  InferAttributes<WorkflowInstance>,
  InferCreationAttributes<WorkflowInstance>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  workflowId: string;
  resourceId: string;
  status: CreationOptional<(typeof WORKFLOW_INSTANCE_STATUSES)[number]>;
  currentStepOrder: CreationOptional<number>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  workflow?: NonAttribute<ModelInstance<"Workflow">>;
  actions?: NonAttribute<ModelInstance<"WorkflowAction">[]>;
}

interface WorkflowInstanceStatics {
  associate(models: Models): void;
}

type DefineWorkflowInstance = (
  sequelize: Sequelize,
) => TypedModel<WorkflowInstance, WorkflowInstanceStatics>;

/** Define the WorkflowInstance model (a fresh class per call). */
const defineModel: DefineWorkflowInstance = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class WorkflowInstanceModel extends Model {
    static associate(models: Models): void {
      WorkflowInstance.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
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

  const WorkflowInstance = initModel<WorkflowInstance, WorkflowInstanceStatics>(
    WorkflowInstanceModel,
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
        type: DataTypes.ENUM(...WORKFLOW_INSTANCE_STATUSES),
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
    },
  );

  return WorkflowInstance;
};

export = defineModel;
