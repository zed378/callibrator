// P9-10 (ADR-087 Amendments 7–8): converted from sopTrainingAcknowledgment.model.js with no behaviour
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
const SOP_ACKNOWLEDGMENT_STATUSES = ["PENDING", "COMPLETED"] as const;

/** A SopTrainingAcknowledgment row (attributes, included associations, instance methods). Types only: emits nothing. */
interface SopTrainingAcknowledgment extends Model<
  InferAttributes<SopTrainingAcknowledgment>,
  InferCreationAttributes<SopTrainingAcknowledgment>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  documentId: string;
  userId: UserId;
  acknowledgedAt: Date | null;
  status: CreationOptional<(typeof SOP_ACKNOWLEDGMENT_STATUSES)[number]>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  document?: NonAttribute<ModelInstance<"SopDocument">>;
  user?: NonAttribute<ModelInstance<"User">>;
}

interface SopTrainingAcknowledgmentStatics {
  associate(models: Models): void;
}

type DefineSopTrainingAcknowledgment = (
  sequelize: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<SopTrainingAcknowledgment, SopTrainingAcknowledgmentStatics>;

/** Define the SopTrainingAcknowledgment model (a fresh class per call). */
const defineModel: DefineSopTrainingAcknowledgment = (sequelize, DataTypes) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class SopTrainingAcknowledgmentModel extends Model {
    static associate(models: Models): void {
      SopTrainingAcknowledgment.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      SopTrainingAcknowledgment.belongsTo(models.SopDocument, {
        foreignKey: "documentId",
        as: "document",
        onDelete: "RESTRICT",
      });
      SopTrainingAcknowledgment.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
        onDelete: "RESTRICT",
      });
    }
  }

  const SopTrainingAcknowledgment = initModel<
    SopTrainingAcknowledgment,
    SopTrainingAcknowledgmentStatics
  >(
    SopTrainingAcknowledgmentModel,
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
        onDelete: "RESTRICT",
      },
      documentId: {
        type: DataTypes.UUID,
        field: "document_id",
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        field: "user_id",
        allowNull: false,
      },
      acknowledgedAt: {
        type: DataTypes.DATE,
        field: "acknowledged_at",
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...SOP_ACKNOWLEDGMENT_STATUSES),
        defaultValue: "PENDING",
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "SopTrainingAcknowledgment",
      tableName: "sop_training_acknowledgments",
      timestamps: true,
      underscored: true,
    },
  );

  return SopTrainingAcknowledgment;
};

export = defineModel;
