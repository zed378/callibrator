// P9-10 (ADR-087 Amendments 7–8): converted from batchJob.model.js with no behaviour
// change — definition equality against the JavaScript original (ADR-092 check (b)).
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** The `status` ENUM's values, in the column's order (D-26 holds them against pg_enum). */
const BATCH_JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

/** A BatchJob row (attributes, included associations, instance methods). Types only: emits nothing. */
interface BatchJob extends Model<
  InferAttributes<BatchJob>,
  InferCreationAttributes<BatchJob>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  userId: UserId | null;
  type: string;
  status: CreationOptional<(typeof BATCH_JOB_STATUSES)[number]>;
  progress: CreationOptional<number>;
  totalItems: CreationOptional<number | null>;
  processedItems: CreationOptional<number | null>;
  resultUrl: string | null;
  errorDetails: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface BatchJobStatics {
  associate(models: Models): void;
}

type DefineBatchJob = (
  sequelize: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<BatchJob, BatchJobStatics>;

/** Define the BatchJob model (a fresh class per call). */
const defineModel: DefineBatchJob = (sequelize, DataTypes) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class BatchJobModel extends Model {
    static associate(models: Models): void {
      BatchJob.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "CASCADE",
      });
      BatchJob.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        onDelete: "SET NULL",
      });
    }
  }

  const BatchJob = initModel<BatchJob, BatchJobStatics>(
    BatchJobModel,
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        field: "tenant_id",
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.UUID,
        field: "user_id",
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...BATCH_JOB_STATUSES),
        defaultValue: "PENDING",
        allowNull: false,
      },
      progress: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
      },
      totalItems: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      processedItems: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      resultUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      errorDetails: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "BatchJob",
      tableName: "batch_jobs",
      timestamps: true,
      underscored: true,
    },
  );

  return BatchJob;
};

export = defineModel;
