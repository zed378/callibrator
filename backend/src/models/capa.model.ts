// P9-10 (ADR-087 Amendments 7–8): converted from capa.model.js with no behaviour
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
import { CAPA_STATUSES, type CapaStatus } from "../constants/qmsConstants";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** A Capa row (attributes, included associations, instance methods). Types only: emits nothing. */
interface Capa extends Model<
  InferAttributes<Capa>,
  InferCreationAttributes<Capa>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  capaNumber: string;
  ncId: string;
  title: string;
  actionPlan: string;
  status: CreationOptional<CapaStatus>;
  assignedTo: UserId | null;
  dueDate: Date | null;
  completedDate: Date | null;
  approvedBy: UserId | null;
  verificationNotes: string | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  nonConformance?: NonAttribute<ModelInstance<"NonConformance">>;
  assignee?: NonAttribute<ModelInstance<"User">>;
  approver?: NonAttribute<ModelInstance<"User">>;
}

interface CapaStatics {
  associate(models: Models): void;
}

type DefineCapa = (
  sequelize: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<Capa, CapaStatics>;

/** Define the Capa model (a fresh class per call). */
const defineModel: DefineCapa = (sequelize, DataTypes) => {
  // The class keeps its static (and prototype) members as class members — non-enumerable, as
  // the JavaScript had them. Its name is set to the modelName by init, as before.
  class CapaModel extends Model {
    static associate(models: Models): void {
      Capa.belongsTo(models.Tenant, {
        foreignKey: "tenantId",
        as: "tenant",
        onDelete: "RESTRICT",
      });
      Capa.belongsTo(models.NonConformance, {
        foreignKey: "ncId",
        as: "nonConformance",
        onDelete: "RESTRICT",
      });
      Capa.belongsTo(models.User, {
        foreignKey: "assignedTo",
        as: "assignee",
        onDelete: "SET NULL",
      });
      Capa.belongsTo(models.User, {
        foreignKey: "approvedBy",
        as: "approver",
        onDelete: "RESTRICT",
      });
    }
  }

  const Capa = initModel<Capa, CapaStatics>(
    CapaModel,
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
      capaNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "capa_number",
      },
      ncId: {
        type: DataTypes.UUID,
        field: "nc_id",
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      actionPlan: {
        type: DataTypes.TEXT,
        field: "action_plan",
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...CAPA_STATUSES),
        defaultValue: "DRAFT",
        allowNull: false,
      },
      assignedTo: {
        type: DataTypes.UUID,
        field: "assigned_to",
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATE,
        field: "due_date",
        allowNull: true,
      },
      completedDate: {
        type: DataTypes.DATE,
        field: "completed_date",
        allowNull: true,
      },
      approvedBy: {
        type: DataTypes.UUID,
        field: "approved_by",
        allowNull: true,
      },
      verificationNotes: {
        type: DataTypes.TEXT,
        field: "verification_notes",
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Capa",
      tableName: "capas",
      timestamps: true,
      paranoid: true,
      underscored: true,
    },
  );

  return Capa;
};

export = defineModel;
