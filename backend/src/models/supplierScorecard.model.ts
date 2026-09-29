/**
 * SupplierScorecard Model (ISO 9001/17025)
 */
// P9-10 (ADR-087 Amendments 7–8): converted from supplierScorecard.model.js with no behaviour
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

/** A SupplierScorecard row (attributes, included associations, instance methods). Types only: emits nothing. */
interface SupplierScorecard extends Model<
  InferAttributes<SupplierScorecard>,
  InferCreationAttributes<SupplierScorecard>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  vendorId: string;
  evaluationDate: Date;
  qualityScore: CreationOptional<number>;
  deliveryScore: CreationOptional<number>;
  serviceScore: CreationOptional<number>;
  /** VIRTUAL: the rounded mean of the three scores (the getter). */
  overallScore: CreationOptional<number>;
  status: CreationOptional<string>;
  comments: string | null;
  evaluatedBy: UserId | null;
  nextEvaluationDate: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  vendor?: NonAttribute<ModelInstance<"Vendor">>;
  evaluator?: NonAttribute<ModelInstance<"User">>;
}

interface SupplierScorecardStatics {
  associate: (models: Models) => void;
}

type DefineSupplierScorecard = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<SupplierScorecard, SupplierScorecardStatics>;

/** Define the SupplierScorecard model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineSupplierScorecard = (db, DataTypes) => {
  const SupplierScorecard = initModel<
    SupplierScorecard,
    SupplierScorecardStatics
  >(
    class extends Model {},
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
      },
      vendorId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "vendors", key: "id" },
        onDelete: "RESTRICT",
      },
      evaluationDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      qualityScore: {
        type: DataTypes.INTEGER, // 0-100
        allowNull: false,
        defaultValue: 0,
      },
      deliveryScore: {
        type: DataTypes.INTEGER, // 0-100
        allowNull: false,
        defaultValue: 0,
      },
      serviceScore: {
        type: DataTypes.INTEGER, // 0-100
        allowNull: false,
        defaultValue: 0,
      },
      overallScore: {
        type: DataTypes.VIRTUAL,
        get(this: SupplierScorecard): number {
          return Math.round(
            (this.qualityScore + this.deliveryScore + this.serviceScore) / 3,
          );
        },
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "APPROVED", // APPROVED, PROBATION, DISQUALIFIED
      },
      comments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      evaluatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      nextEvaluationDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "supplier_scorecards",
      timestamps: true,
      paranoid: true,
      underscored: true,
      modelName: "SupplierScorecard",
      sequelize: db,
    },
  );

  SupplierScorecard.associate = (models: Models): void => {
    SupplierScorecard.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    SupplierScorecard.belongsTo(models.Vendor, {
      foreignKey: "vendorId",
      as: "vendor",
      onDelete: "RESTRICT",
    });
    SupplierScorecard.belongsTo(models.User, {
      foreignKey: "evaluatedBy",
      as: "evaluator",
      onDelete: "SET NULL",
    });
  };

  return SupplierScorecard;
};

export = defineModel;
