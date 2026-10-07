/**
 * InspectionTemplateItem Model — one item of one template version: a FROZEN
 * copy of a library definition, the id an IPM result pins (P20-03; ADR-125 and
 * its Amendment 1; spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.5).
 *
 * The copy IS the content: the operator may edit it in a draft (a
 * type-specific limit, say) without touching the library. `itemDefinitionId`
 * is NOT NULL (G-8): every item is an instance of a library definition — the
 * cross-version identity of "the same check". `origin` is `base` for the base
 * template's items materialised into a type version at publish, `type` for
 * the type's own.
 *
 * Held by the DATABASE (migration 0112): an INSERT, UPDATE or DELETE is refused
 * unless the parent version is a draft — for every role; the same definition
 * at most once per version; one item per (section, origin, position).
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
import {
  TEMPLATE_ITEM_ORIGINS,
  type InspectionInputKind,
  type InspectionLimitOp,
  type InspectionOutcome,
  type InspectionSection,
  type TemplateItemOrigin,
} from "@callibrator/contracts/inspectionValues";
import type { InspectionItemDefinitionId, InspectionTemplateItemId, InspectionTemplateVersionId } from "../types/ids";
import type { ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";
import { inspectionContentAttributes } from "./inspectionContent";

/** An InspectionTemplateItem row. Types only: emits nothing. Decimals are strings (NUMERIC). */
interface InspectionTemplateItem extends Model<
  InferAttributes<InspectionTemplateItem>,
  InferCreationAttributes<InspectionTemplateItem>
> {
  id: CreationOptional<InspectionTemplateItemId>;
  versionId: InspectionTemplateVersionId;
  itemDefinitionId: InspectionItemDefinitionId;
  origin: TemplateItemOrigin;
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
  /** Submit refuses a session with a required item unanswered (P19-02). */
  required: boolean;
  /** Order inside its section; base items sort before type items of the same section. */
  sortOrder: number;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;

  version?: NonAttribute<ModelInstance<"InspectionTemplateVersion">>;
  itemDefinition?: NonAttribute<ModelInstance<"InspectionItemDefinition">>;
}

interface InspectionTemplateItemStatics {
  associate: (models: Models) => void;
}

type DefineInspectionTemplateItem = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionTemplateItem, InspectionTemplateItemStatics>;

/** Define the InspectionTemplateItem model on `db`. */
const defineModel: DefineInspectionTemplateItem = (db, DataTypes) => {
  const InspectionTemplateItem = initModel<InspectionTemplateItem, InspectionTemplateItemStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      versionId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "inspection_template_versions", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      itemDefinitionId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "inspection_item_definitions", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      origin: { type: DataTypes.ENUM(...TEMPLATE_ITEM_ORIGINS), allowNull: false },
      ...inspectionContentAttributes(DataTypes),
      required: { type: DataTypes.BOOLEAN, allowNull: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      tableName: "inspection_template_items",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionTemplateItem",
      sequelize: db,
    },
  );

  InspectionTemplateItem.associate = (models: Models): void => {
    // Global → global only (ADR-125 § 7).
    InspectionTemplateItem.belongsTo(models.InspectionTemplateVersion, {
      foreignKey: "versionId",
      as: "version",
      onDelete: "RESTRICT",
    });
    InspectionTemplateItem.belongsTo(models.InspectionItemDefinition, {
      foreignKey: "itemDefinitionId",
      as: "itemDefinition",
      onDelete: "RESTRICT",
    });
  };

  return InspectionTemplateItem;
};

export = defineModel;
