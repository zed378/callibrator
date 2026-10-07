/**
 * InspectionItemDefinition Model — one entry of the GLOBAL inspection item
 * library (P20-03; ADR-125 and its Amendment 1; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.2).
 *
 * A reusable check: its section, label, input kind, unit, structured limit
 * (`limitOp` with value / low-high / nominal-tolerance and the verbatim
 * `limitText`), hard (`valid*`) and soft (`warn*`) input ranges and outcome
 * set. Mutable while active: a template draft COPIES it into an
 * InspectionTemplateItem when the item is added, so an edit here never reaches
 * an existing draft or version. `notes` is operator-only (never copied, never
 * returned to tenants).
 *
 * GLOBAL (no `tenantId`, no `clientFacilityId`); NOT paranoid, NO defaultScope
 * (G-4); NO association to a tenant model (ADR-125 § 7). Listed in
 * unscopedModels.d17 as `global`. The table, its CHECKs, indexes and its
 * no-delete trigger are migration 0112's; none is declared here.
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
import {
  INSPECTION_ITEM_DEFINITION_STATUSES,
  type InspectionItemDefinitionStatus,
} from "@callibrator/contracts/states";
import type {
  InspectionInputKind,
  InspectionLimitOp,
  InspectionOutcome,
  InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import type { InspectionItemDefinitionId, UserId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";
import { inspectionContentAttributes } from "./inspectionContent";

/** An InspectionItemDefinition row. Types only: emits nothing. Decimals are strings (NUMERIC). */
interface InspectionItemDefinition extends Model<
  InferAttributes<InspectionItemDefinition>,
  InferCreationAttributes<InspectionItemDefinition>
> {
  id: CreationOptional<InspectionItemDefinitionId>;
  section: InspectionSection;
  label: string;
  inputKind: InspectionInputKind;
  unit: CreationOptional<string | null>;
  symbol: CreationOptional<string | null>;
  settingText: CreationOptional<string | null>;
  settingValue: CreationOptional<string | null>;
  limitOp: CreationOptional<InspectionLimitOp | null>;
  limitValue: CreationOptional<string | null>;
  limitLow: CreationOptional<string | null>;
  limitHigh: CreationOptional<string | null>;
  limitNominal: CreationOptional<string | null>;
  limitTolerance: CreationOptional<string | null>;
  limitText: CreationOptional<string | null>;
  validMin: CreationOptional<string | null>;
  validMax: CreationOptional<string | null>;
  warnMin: CreationOptional<string | null>;
  warnMax: CreationOptional<string | null>;
  allowedOutcomes: InspectionOutcome[];
  /** Copied to a template item's `required` when it is added to a draft. */
  defaultRequired: CreationOptional<boolean>;
  /** Operator-only free text: never copied into a version, never returned to tenants. */
  notes: CreationOptional<string | null>;
  status: CreationOptional<InspectionItemDefinitionStatus>;
  /** Upstream provenance (P24-02): `mst_*` table and id; never returned to tenants. */
  legacyTable: CreationOptional<string | null>;
  legacyId: CreationOptional<number | null>;
  createdBy: CreationOptional<UserId | null>;
  updatedBy: CreationOptional<UserId | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  templateItems?: NonAttribute<ModelInstance<"InspectionTemplateItem">[]>;
}

interface InspectionItemDefinitionStatics {
  associate: (models: Models) => void;
}

type DefineInspectionItemDefinition = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionItemDefinition, InspectionItemDefinitionStatics>;

/** Define the InspectionItemDefinition model on `db`. */
const defineModel: DefineInspectionItemDefinition = (db, DataTypes) => {
  const user = { model: "users", key: "id" };
  const InspectionItemDefinition = initModel<InspectionItemDefinition, InspectionItemDefinitionStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      ...inspectionContentAttributes(DataTypes),
      defaultRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM(...INSPECTION_ITEM_DEFINITION_STATUSES), allowNull: false, defaultValue: "active" },
      legacyTable: { type: DataTypes.STRING(64), allowNull: true },
      legacyId: { type: DataTypes.INTEGER, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
      updatedBy: { type: DataTypes.UUID, allowNull: true, references: user, onDelete: "RESTRICT", onUpdate: "CASCADE" },
    },
    {
      tableName: "inspection_item_definitions",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionItemDefinition",
      sequelize: db,
    },
  );

  InspectionItemDefinition.associate = (models: Models): void => {
    // Global → global only (ADR-125 § 7): the frozen copies of this definition, across versions.
    InspectionItemDefinition.hasMany(models.InspectionTemplateItem, {
      foreignKey: "itemDefinitionId",
      as: "templateItems",
      onDelete: "RESTRICT",
    });
  };

  return InspectionItemDefinition;
};

export = defineModel;
