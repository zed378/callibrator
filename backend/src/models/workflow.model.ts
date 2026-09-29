// P9-10 (ADR-087 Amendments 7–8): converted from workflow.model.js with no behaviour
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

/** The `resourceType` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const WORKFLOW_RESOURCE_TYPES = [
  "Certificate",
  "StockTransfer",
  "MaintenanceWorkOrder",
] as const;

/** A Workflow row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Workflow extends Model<
  InferAttributes<Workflow>,
  InferCreationAttributes<Workflow>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  name: string;
  resourceType: (typeof WORKFLOW_RESOURCE_TYPES)[number];
  isActive: CreationOptional<boolean | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  steps?: NonAttribute<ModelInstance<"WorkflowStep">[]>;
  instances?: NonAttribute<ModelInstance<"WorkflowInstance">[]>;
}

interface WorkflowStatics {
  associate(models: Models): void;
}

type DefineWorkflow = (
  sequelize: Sequelize,
) => TypedModel<Workflow, WorkflowStatics>;

/** Define the Workflow model (a fresh class per call). */
const defineModel: DefineWorkflow = (sequelize) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class WorkflowModel extends Model {
    static associate(models: Models): void {
      Workflow.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
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

  const Workflow = initModel<Workflow, WorkflowStatics>(
    WorkflowModel,
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
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      resourceType: {
        type: DataTypes.ENUM(...WORKFLOW_RESOURCE_TYPES),
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
    },
  );

  return Workflow;
};

export = defineModel;
