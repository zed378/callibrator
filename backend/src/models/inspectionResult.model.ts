/**
 * InspectionResult Model — one answered item of one IPM session (P20-04; ADR-126 and its
 * Amendment 1; spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 4.2; P19-01 spec § 5, § 6).
 *
 * A template row pins its `templateItemId` (and the item's library definition, the cross-version
 * identity), with the SERVER's label snapshot; an ad-hoc row (`isAdHoc`, sections that allow it)
 * and an imported row carry their own snapshots. Held by the DATABASE, for every role (migrations
 * 0126 and 0127): a result is written only while its session is a draft (a draft's results are
 * replaced wholesale — the application role keeps DELETE); one row per template item; the
 * composite key `(tenant_id, client_facility_id, session_id)` to the session (ON UPDATE CASCADE —
 * a device move carries it through the session).
 *
 * The measured values are NUMERIC read back as EXACT decimal strings — the reviewed D-21 exception
 * of ADR-125 Am. 2 § 2, extended to these three attributes (spec § 4.2).
 *
 * TENANT- and FACILITY-scoped: `clientFacilityId` is the session's (filled on insert by the
 * database, `facility_insert_default('result')`), nullable here and without `references`. NOT
 * paranoid, NO defaultScope; no index declared (all in 0126 — ADR-100 Am. 3).
 */
import {
  Model,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import {
  INSPECTION_CLEANLINESS,
  INSPECTION_INPUT_KINDS,
  INSPECTION_OUTCOMES,
  INSPECTION_OUTCOME_SOURCES,
  INSPECTION_OVERALL_OUTCOMES,
  INSPECTION_SECTIONS,
  type InspectionCleanliness,
  type InspectionInputKind,
  type InspectionOutcome,
  type InspectionOutcomeSource,
  type InspectionOverallOutcome,
  type InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import type {
  ClientFacilityId,
  InspectionItemDefinitionId,
  InspectionResultId,
  InspectionSessionId,
  InspectionTemplateItemId,
  TenantId,
} from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An InspectionResult row. Types only: emits nothing. Decimals are strings (NUMERIC). */
interface InspectionResult extends Model<InferAttributes<InspectionResult>, InferCreationAttributes<InspectionResult>> {
  id: CreationOptional<InspectionResultId>;
  tenantId: TenantId;
  clientFacilityId: CreationOptional<ClientFacilityId>;
  sessionId: InspectionSessionId;
  section: InspectionSection;
  inputKind: InspectionInputKind;
  templateItemId: CreationOptional<InspectionTemplateItemId | null>;
  itemDefinitionId: CreationOptional<InspectionItemDefinitionId | null>;
  isAdHoc: CreationOptional<boolean>;
  labelSnapshot: string;
  unit: CreationOptional<string | null>;
  symbol: CreationOptional<string | null>;
  settingText: CreationOptional<string | null>;
  referenceText: CreationOptional<string | null>;
  outcome: CreationOptional<InspectionOutcome | null>;
  cleanliness: CreationOptional<InspectionCleanliness | null>;
  measuredValue: CreationOptional<string | null>;
  measuredValue1: CreationOptional<string | null>;
  measuredValue2: CreationOptional<string | null>;
  textValue: CreationOptional<string | null>;
  rawValue: CreationOptional<string | null>;
  computedOutcome: CreationOptional<InspectionOverallOutcome | null>;
  outcomeSource: CreationOptional<InspectionOutcomeSource | null>;
  warnFlag: CreationOptional<boolean>;
  disagreementFlag: CreationOptional<boolean>;
  sortOrder: number;
  legacyTable: CreationOptional<string | null>;
  legacyId: CreationOptional<number | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

interface InspectionResultStatics {
  associate: (models: Models) => void;
}

type DefineInspectionResult = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionResult, InspectionResultStatics>;

/** Define the InspectionResult model on `db`. */
const defineModel: DefineInspectionResult = (db, DataTypes) => {
  const restrictFk = (table: string) => ({
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: table, key: "id" },
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
  });
  const decimal = (field: string) => ({ type: DataTypes.DECIMAL, allowNull: true, field });
  const InspectionResult = initModel<InspectionResult, InspectionResultStatics>(
    class extends Model {},
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "tenants", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      },
      // NOT NULL in the database (0126); filled from the session on insert.
      clientFacilityId: { type: DataTypes.UUID, allowNull: true },
      // The composite key (tenant_id, client_facility_id, session_id) is the migration's.
      sessionId: { type: DataTypes.UUID, allowNull: false },
      section: { type: DataTypes.ENUM(...INSPECTION_SECTIONS), allowNull: false },
      inputKind: { type: DataTypes.ENUM(...INSPECTION_INPUT_KINDS), allowNull: false },
      templateItemId: restrictFk("inspection_template_items"),
      itemDefinitionId: restrictFk("inspection_item_definitions"),
      isAdHoc: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      labelSnapshot: { type: DataTypes.STRING(255), allowNull: false },
      unit: { type: DataTypes.STRING(20), allowNull: true },
      symbol: { type: DataTypes.STRING(50), allowNull: true },
      settingText: { type: DataTypes.STRING(50), allowNull: true },
      referenceText: { type: DataTypes.STRING(100), allowNull: true },
      outcome: { type: DataTypes.ENUM(...INSPECTION_OUTCOMES), allowNull: true },
      cleanliness: { type: DataTypes.ENUM(...INSPECTION_CLEANLINESS), allowNull: true },
      measuredValue: decimal("measured_value"),
      // Named: `underscored` would make these measured_value1 / measured_value2.
      measuredValue1: decimal("measured_value_1"),
      measuredValue2: decimal("measured_value_2"),
      textValue: { type: DataTypes.STRING(500), allowNull: true },
      rawValue: { type: DataTypes.STRING(255), allowNull: true },
      computedOutcome: { type: DataTypes.ENUM(...INSPECTION_OVERALL_OUTCOMES), allowNull: true },
      outcomeSource: { type: DataTypes.ENUM(...INSPECTION_OUTCOME_SOURCES), allowNull: true },
      warnFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      disagreementFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false },
      legacyTable: { type: DataTypes.STRING(64), allowNull: true },
      legacyId: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: "inspection_results",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionResult",
      sequelize: db,
    },
  );

  InspectionResult.associate = (models: Models): void => {
    InspectionResult.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    // Composite in the database (0126): no single-column key from sync.
    InspectionResult.belongsTo(models.InspectionSession, { foreignKey: "sessionId", as: "session", constraints: false });
    InspectionResult.belongsTo(models.InspectionTemplateItem, {
      foreignKey: "templateItemId",
      as: "templateItem",
      onDelete: "RESTRICT",
    });
  };

  return InspectionResult;
};

export = defineModel;
