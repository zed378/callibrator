/**
 * InspectionSession Model — one IPM visit's record: a draft a technician fills, then an issued
 * record (P20-04; ADR-126 and its Amendments 1–2; spec MEMORY/specs/P19-02-ipm-session-aggregate.md
 * § 4.1, MEMORY/specs/P19-06-ipm-report-document.md § 4.1).
 *
 * A session is `draft` → `submitted` | `discarded`, `submitted` → `voided`; a correction is a new
 * draft naming the session it corrects (`supersedesId`), and its submit stamps the original's
 * `supersededById`. Held by the DATABASE, for every role (migrations 0126 and 0127): the CHECKs of
 * spec § 4.1, the partial unique indexes (one visit number per device root, one correction per
 * session, one open root draft per creator and device, `client_ref` per creator, `report_number`
 * per tenant), the composite key `(tenant_id, client_facility_id, device_id)` to the device (ON
 * UPDATE CASCADE — a device move carries it), and the append-only trigger: after the draft ends
 * only the lifecycle columns change, each once.
 *
 * TENANT- and FACILITY-scoped: `clientFacilityId` is the device's (filled on insert by the
 * database, `facility_insert_default('child')` — ADR-124 Am. 3), declared nullable and without
 * `references` (the key is composite — facilityScopedModels.guard). NOT paranoid, NO defaultScope
 * (G-S4: an include of a session must never become an INNER JOIN); `discarded` and `voided` are the
 * removals. No index is declared here: every index is the migration's (ADR-100 Am. 3).
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
  INSPECTION_OVERALL_OUTCOMES,
  INSPECTION_RECOMMENDATIONS,
  type InspectionOverallOutcome,
  type InspectionRecommendation,
} from "@callibrator/contracts/inspectionValues";
import { INSPECTION_SESSION_STATUSES, type InspectionSessionStatus } from "@callibrator/contracts/states";
import {
  jsonShape,
  type IpmDeviceSnapshot,
  type IpmFacilitySnapshot,
  type IpmIssuerSnapshot,
  type IpmPersonSnapshot,
  type IpmSideEffects,
} from "../utils/jsonShape.util";
import type { ClientFacilityId, InspectionSessionId, InspectionTemplateVersionId, TenantId, UserId } from "../types/ids";
import type { Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/** An InspectionSession row. Types only: emits nothing. */
interface InspectionSession extends Model<InferAttributes<InspectionSession>, InferCreationAttributes<InspectionSession>> {
  id: CreationOptional<InspectionSessionId>;
  tenantId: TenantId;
  clientFacilityId: CreationOptional<ClientFacilityId>;
  deviceId: string;
  templateVersionId: CreationOptional<InspectionTemplateVersionId | null>;
  status: CreationOptional<InspectionSessionStatus>;
  revision: CreationOptional<number>;
  supersedesId: CreationOptional<InspectionSessionId | null>;
  correctionReason: CreationOptional<string | null>;
  supersededById: CreationOptional<InspectionSessionId | null>;
  supersededAt: CreationOptional<Date | null>;
  performedAt: CreationOptional<Date>;
  receivedAt: CreationOptional<Date>;
  capturedOffline: CreationOptional<boolean>;
  clientCapturedAt: CreationOptional<Date | null>;
  clientRef: CreationOptional<string | null>;
  createdBy: CreationOptional<UserId | null>;
  updatedBy: CreationOptional<UserId | null>;
  performedBy: CreationOptional<UserId | null>;
  submittedAt: CreationOptional<Date | null>;
  submittedBy: CreationOptional<UserId | null>;
  /** JSONB, D-27 shape `InspectionSession.performerSnapshot`. */
  performerSnapshot: CreationOptional<IpmPersonSnapshot | null>;
  /** JSONB, D-27 shape `InspectionSession.deviceSnapshot`. */
  deviceSnapshot: CreationOptional<IpmDeviceSnapshot | null>;
  /** JSONB, D-27 shape `InspectionSession.facilitySnapshot`. */
  facilitySnapshot: CreationOptional<IpmFacilitySnapshot | null>;
  roomSnapshot: CreationOptional<string | null>;
  floorSnapshot: CreationOptional<string | null>;
  locationId: CreationOptional<string | null>;
  visitNumber: CreationOptional<number | null>;
  legacyVisitNumber: CreationOptional<number | null>;
  inspectionOutcome: CreationOptional<InspectionOverallOutcome | null>;
  maintenanceOutcome: CreationOptional<InspectionOverallOutcome | null>;
  recommendation: CreationOptional<InspectionRecommendation | null>;
  notes: CreationOptional<string | null>;
  workOrderId: CreationOptional<string | null>;
  followUpWorkOrderId: CreationOptional<string | null>;
  /** JSONB, D-27 shape `InspectionSession.sideEffects`. */
  sideEffects: CreationOptional<IpmSideEffects | null>;
  voidReason: CreationOptional<string | null>;
  voidedBy: CreationOptional<UserId | null>;
  voidedAt: CreationOptional<Date | null>;
  discardedBy: CreationOptional<UserId | null>;
  discardedAt: CreationOptional<Date | null>;
  /** `<qr>|<date>` of an imported session; never in a response contract (FT-104). */
  legacyKey: CreationOptional<string | null>;
  reportNumber: CreationOptional<string | null>;
  /** 24 CSPRNG bytes, base64url — generated at submit, never from a body (P19-06 § 4.1). */
  verificationToken: CreationOptional<string | null>;
  reportContentHash: CreationOptional<string | null>;
  reportHashScheme: CreationOptional<string | null>;
  /** JSONB, D-27 shape `InspectionSession.issuerSnapshot`. */
  issuerSnapshot: CreationOptional<IpmIssuerSnapshot | null>;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
}

interface InspectionSessionStatics {
  associate: (models: Models) => void;
}

type DefineInspectionSession = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<InspectionSession, InspectionSessionStatics>;

/** Define the InspectionSession model on `db`. */
const defineModel: DefineInspectionSession = (db, DataTypes) => {
  const userFk = () => ({
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: "users", key: "id" },
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
  });
  const restrictFk = (table: string) => ({
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: table, key: "id" },
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
  });
  const InspectionSession = initModel<InspectionSession, InspectionSessionStatics>(
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
      // NOT NULL in the database (0126); filled from the device on insert (ADR-124 Am. 3).
      clientFacilityId: { type: DataTypes.UUID, allowNull: true },
      // The composite key (tenant_id, client_facility_id, device_id) is the migration's.
      deviceId: { type: DataTypes.UUID, allowNull: false },
      templateVersionId: restrictFk("inspection_template_versions"),
      status: { type: DataTypes.ENUM(...INSPECTION_SESSION_STATUSES), allowNull: false, defaultValue: "draft" },
      revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      supersedesId: restrictFk("inspection_sessions"),
      correctionReason: { type: DataTypes.TEXT, allowNull: true },
      supersededById: restrictFk("inspection_sessions"),
      supersededAt: { type: DataTypes.DATE, allowNull: true },
      performedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      receivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      capturedOffline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      clientCapturedAt: { type: DataTypes.DATE, allowNull: true },
      clientRef: { type: DataTypes.UUID, allowNull: true },
      createdBy: userFk(),
      updatedBy: userFk(),
      performedBy: userFk(),
      submittedAt: { type: DataTypes.DATE, allowNull: true },
      submittedBy: userFk(),
      performerSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("InspectionSession.performerSnapshot") },
      },
      deviceSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("InspectionSession.deviceSnapshot") },
      },
      facilitySnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("InspectionSession.facilitySnapshot") },
      },
      roomSnapshot: { type: DataTypes.STRING(255), allowNull: true },
      floorSnapshot: { type: DataTypes.STRING(50), allowNull: true },
      locationId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "warehouses", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },
      visitNumber: { type: DataTypes.INTEGER, allowNull: true },
      legacyVisitNumber: { type: DataTypes.SMALLINT, allowNull: true },
      inspectionOutcome: { type: DataTypes.ENUM(...INSPECTION_OVERALL_OUTCOMES), allowNull: true },
      maintenanceOutcome: { type: DataTypes.ENUM(...INSPECTION_OVERALL_OUTCOMES), allowNull: true },
      recommendation: { type: DataTypes.ENUM(...INSPECTION_RECOMMENDATIONS), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      workOrderId: restrictFk("maintenance_work_orders"),
      followUpWorkOrderId: restrictFk("maintenance_work_orders"),
      sideEffects: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("InspectionSession.sideEffects") },
      },
      voidReason: { type: DataTypes.TEXT, allowNull: true },
      voidedBy: userFk(),
      voidedAt: { type: DataTypes.DATE, allowNull: true },
      discardedBy: userFk(),
      discardedAt: { type: DataTypes.DATE, allowNull: true },
      legacyKey: { type: DataTypes.STRING(64), allowNull: true },
      reportNumber: { type: DataTypes.STRING(48), allowNull: true },
      verificationToken: { type: DataTypes.STRING(64), allowNull: true },
      reportContentHash: { type: DataTypes.CHAR(64), allowNull: true },
      reportHashScheme: { type: DataTypes.STRING(32), allowNull: true },
      issuerSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: { shape: jsonShape("InspectionSession.issuerSnapshot") },
      },
    },
    {
      tableName: "inspection_sessions",
      timestamps: true,
      paranoid: false,
      underscored: true,
      modelName: "InspectionSession",
      sequelize: db,
    },
  );

  InspectionSession.associate = (models: Models): void => {
    InspectionSession.belongsTo(models.Tenant, { foreignKey: "tenantId", as: "tenant", onDelete: "RESTRICT" });
    // Composite in the database (0126): no single-column key from sync.
    InspectionSession.belongsTo(models.CalibrationDevice, { foreignKey: "deviceId", as: "device", constraints: false });
    InspectionSession.belongsTo(models.InspectionTemplateVersion, {
      foreignKey: "templateVersionId",
      as: "templateVersion",
      onDelete: "RESTRICT",
    });
    InspectionSession.hasMany(models.InspectionResult, { foreignKey: "sessionId", as: "results", constraints: false });
    InspectionSession.hasMany(models.InspectionSessionSignature, { foreignKey: "sessionId", as: "signatures", constraints: false });
  };

  return InspectionSession;
};

export = defineModel;
