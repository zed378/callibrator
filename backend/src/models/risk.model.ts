/**
 * Risk Model (ISO 14971)
 */
// P9-10 (ADR-087 Amendments 7–8): converted from risk.model.js with no behaviour
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

/** A Risk row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Risk extends Model<
  InferAttributes<Risk>,
  InferCreationAttributes<Risk>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  title: string;
  description: string | null;
  category: CreationOptional<string>;
  severity: CreationOptional<number>;
  likelihood: CreationOptional<number>;
  /** VIRTUAL: severity × likelihood (the getter). */
  rpn: CreationOptional<number>;
  status: CreationOptional<string>;
  mitigationPlan: string | null;
  identifiedBy: UserId | null;
  assignedTo: UserId | null;
  dueDate: Date | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  identifier?: NonAttribute<ModelInstance<"User">>;
  assignee?: NonAttribute<ModelInstance<"User">>;
}

interface RiskStatics {
  associate: (models: Models) => void;
}

type DefineRisk = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Risk, RiskStatics>;

/** Define the Risk model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineRisk = (db, DataTypes) => {
  const Risk = initModel<Risk, RiskStatics>(
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
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: "OPERATIONAL", // OPERATIONAL, FINANCIAL, COMPLIANCE, STRATEGIC, SAFETY
      },
      severity: {
        type: DataTypes.INTEGER, // 1-5
        allowNull: false,
        defaultValue: 1,
      },
      likelihood: {
        type: DataTypes.INTEGER, // 1-5
        allowNull: false,
        defaultValue: 1,
      },
      // Calculated Risk Priority Number (severity * likelihood)
      rpn: {
        type: DataTypes.VIRTUAL,
        get(this: Risk): number {
          return this.severity * this.likelihood;
        },
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "OPEN", // OPEN, MITIGATED, CLOSED, ACCEPTED
      },
      mitigationPlan: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      identifiedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      assignedTo: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "risks",
      timestamps: true,
      paranoid: true,
      underscored: true,
      modelName: "Risk",
      sequelize: db,
    },
  );

  Risk.associate = (models: Models): void => {
    Risk.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    Risk.belongsTo(models.User, {
      foreignKey: "identifiedBy",
      as: "identifier",
      onDelete: "SET NULL",
    });
    Risk.belongsTo(models.User, {
      foreignKey: "assignedTo",
      as: "assignee",
      onDelete: "SET NULL",
    });
  };

  return Risk;
};

export = defineModel;
