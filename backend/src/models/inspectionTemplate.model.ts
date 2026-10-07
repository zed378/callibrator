/**
 * InspectionTemplate Model — the checklist of one device type, or THE base
 * template (`deviceTypeId` NULL) whose common sections every type version
 * embeds at publish (P20-03; ADR-125 and its Amendment 1; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.3, § 7.1).
 *
 * The aggregate root of template → versions → items: every write goes through
 * the catalogue service (P21-01) under a row lock on this row. One template
 * per device type, ever, and exactly one base — partial UNIQUE indexes of
 * migration 0112, which also creates the base row.
 *
 * GLOBAL; NOT paranoid, NO defaultScope (G-4); NO association to a tenant
 * model (ADR-125 § 7). Listed in unscopedModels.d17 as `global`.
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import { INSPECTION_TEMPLATE_STATUSES, type InspectionTemplateStatus } from "@callibrator/contracts/states";
import type { DeviceTypeId, InspectionTemplateId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An InspectionTemplate row. Types only: emits nothing. */
interface InspectionTemplate extends Model<
  InferAttributes<InspectionTemplate>,
  InferCreationAttributes<InspectionTemplate>
> {
  id: CreationOptional<InspectionTemplateId>;
  /** NULL = the base template (F-21's common sections). */
  deviceTypeId: DeviceTypeId | null;
  /** A retired template has no published version; sessions for its type fall back to the base. */
  status: CreationOptional<InspectionTemplateStatus>;
  createdBy: CreationOptional<UserId | null>;
  updatedBy: CreationOptional<UserId | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  deviceType?: NonAttribute<ModelInstance<"DeviceType"> | null>;
  versions?: NonAttribute<ModelInstance<"InspectionTemplateVersion">[]>;
}

interface InspectionTemplateStatics {
  associate: (models: Models) => void;
}

type DefineInspectionTemplate = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionTemplate, InspectionTemplateStatics>;

/** Define the InspectionTemplate model on `db`. */
const defineModel: DefineInspectionTemplate = (db, DataTypes) => {
  const user = { model: "users", key: "id" };
  const InspectionTemplate = initModel<InspectionTemplate, InspectionTemplateStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      deviceTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "device_types", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      status: { type: DataTypes.ENUM(...INSPECTION_TEMPLATE_STATUSES), allowNull: false, defaultValue: "active" },
      createdBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      updatedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
    },
    {
      tableName: "inspection_templates",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionTemplate",
      sequelize: db,
    },
  );

  InspectionTemplate.associate = (models: Models): void => {
    // Global → global only (ADR-125 § 7). The base template's type is NULL: a reader says `required: false`.
    InspectionTemplate.belongsTo(models.DeviceType, { foreignKey: "deviceTypeId", as: "deviceType", onDelete: "RESTRICT" });
    InspectionTemplate.hasMany(models.InspectionTemplateVersion, { foreignKey: "templateId", as: "versions", onDelete: "RESTRICT" });
  };

  return InspectionTemplate;
};

export = defineModel;
