/**
 * CalibrationRecord Model
 *
 * Tracks calibration history for devices.
 * Each record contains calibration results, compliance status,
 * and certificate information.
 */
// P9-10 (ADR-087 Amendments 7–8): converted from calibrationRecord.model.js with no behaviour
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
import { jsonShape, type CalibrationResults } from "../utils/jsonShape.util";
import type { TenantId, UserId } from "../types/ids";
import type { DefaultScoped, ModelInstance, Models } from "../types/models";
import { initModel, type TypedModel } from "./initModel";

/**
 * Define the CalibrationRecord model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
/** A CalibrationRecord row (attributes, included associations, instance methods). Types only: emits nothing. */
interface CalibrationRecord extends Model<
  InferAttributes<CalibrationRecord>,
  InferCreationAttributes<CalibrationRecord>
> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  deviceId: string;
  /** Null when an API key recorded it (Q-51): then `apiKeyId` names it. Exactly one is set (CHECK, migration 0105). */
  performedBy: UserId | null;
  /** The API key that recorded it (Q-51); null for a user. Content: immutable after insert (0057 trigger). */
  apiKeyId: string | null;
  calibrationDate: CreationOptional<Date>;
  dueDate: Date | null;
  standard: string | null;
  /** JSONB, D-27 shape `CalibrationRecord.results`. */
  results: CalibrationResults | null;
  measurementUncertainty: number | null;
  isCompliant: boolean | null;
  certificateNumber: string | null;
  certificateFileUrl: string | null;
  notes: string | null;
  /** Set once, by a VOID (P6-03): the trigger refuses true -> false. */
  isDeleted: CreationOptional<boolean>;
  /** P6-03 lifecycle columns (migration 0057): each written once; content never changes after insert. */
  supersedesId: string | null;
  correctionReason: string | null;
  supersededById: string | null;
  supersededAt: Date | null;
  voidReason: string | null;
  voidedBy: UserId | null;
  createdAt: CreationOptional<Date>;
  updatedAt: CreationOptional<Date>;
  deletedAt: CreationOptional<Date | null>;

  tenant?: NonAttribute<ModelInstance<"Tenant">>;
  device?: NonAttribute<ModelInstance<"CalibrationDevice">>;
  performer?: NonAttribute<ModelInstance<"User">>;
  apiKey?: NonAttribute<ModelInstance<"ApiKey">>;
}

interface CalibrationRecordStatics {
  associate: (models: Models) => void;
  /** D-12: the defaultScope carries a `where`, so a bare include is an INNER JOIN. Phantom: never read at run time. */
  readonly defaultScoped: DefaultScoped;
}

type DefineCalibrationRecord = (
  db: Sequelize,
  DataTypes: typeof DataTypesNamespace,
) => TypedModel<CalibrationRecord, CalibrationRecordStatics>;

/** Define the CalibrationRecord model on `db` (a fresh class per call, as `db.define` made). */
const defineModel: DefineCalibrationRecord = (db, DataTypes) => {
  const CalibrationRecord = initModel<
    CalibrationRecord,
    CalibrationRecordStatics
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
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "calibration_devices", key: "id" },
        onDelete: "RESTRICT",
      },
      // Q-51: nullable — a record an API key wrote names the key in
      // api_key_id instead. CHECK calibration_records_actor_exactly_one
      // (migration 0105): exactly one of performed_by / api_key_id is set.
      performedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        // RESTRICT (F-6, ADR-051 Q-16): hard-deleting the performer must not
        // delete the calibration record, nor erase who performed it.
        onDelete: "RESTRICT",
      },
      // Q-51: RESTRICT for the same reason — and SET NULL would break the CHECK.
      apiKeyId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "api_keys", key: "id" },
        onDelete: "RESTRICT",
      },
      calibrationDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      standard: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Calibration standard/reference used",
      },
      results: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("CalibrationRecord.results") },
        allowNull: true,
        comment: "JSON object containing calibration measurements and results",
      },
      measurementUncertainty: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment:
          "Calculated measurement uncertainty for this calibration record",
      },
      isCompliant: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        comment: "Whether the device passed calibration",
      },
      certificateNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      certificateFileUrl: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      // ------------------------------------------------------------------
      // P6-03 — append-only lifecycle (migration 0057, ADR-062).
      // A record's CONTENT never changes after insert: the database trigger
      // `calibration_records_append_only` refuses it for every role. A wrong
      // result is CORRECTED by a new row that supersedes it; a record entered
      // in error is VOIDED. Each lifecycle column below is written once.
      // ------------------------------------------------------------------
      supersedesId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "calibration_records", key: "id" },
        onDelete: "RESTRICT",
        comment: "On a correction: the record this one corrects (immutable)",
      },
      correctionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          "On a correction: why the original was wrong (required with supersedesId)",
      },
      supersededById: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "calibration_records", key: "id" },
        onDelete: "RESTRICT",
        comment:
          "On a corrected record: the correction that replaced it (set once)",
      },
      supersededAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      voidReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Why the record was voided (set once, with isDeleted)",
      },
      voidedBy: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "RESTRICT",
      },
    },
    {
      tableName: "calibration_records",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["device_id"] },
        { fields: ["performed_by"] },
        // No index on api_key_id here: migration 0105 creates <table>_api_key_id.
        // db.sync() runs BEFORE the migrator at boot, and a model index on a
        // column a later migration adds fails CREATE INDEX on an existing
        // database (ADR-100 Amendment 3; guard tests/guards/modelIndexColumns.am3.guard.test.ts).
        { fields: ["calibration_date"] },
        { fields: ["is_compliant"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        // @ts-expect-error -- the key is the COLUMN is_deleted, not the attribute isDeleted: a caller's where on is_deleted REPLACES this default only with the column key (P9-10 spec, probe 3)
        where: { is_deleted: false },
      },
      // A-274 (2026-09-30): the unused `includeDeleted` scope was removed — no
      // caller used it, and `.scope(["defaultScope", "includeDeleted"])` would have
      // silently dropped the soft-delete predicate. Use `.unscoped()` deliberately.
      modelName: "CalibrationRecord",
      sequelize: db,
    },
  );

  // P6-03: there is no softDelete() and no restoreStatic() here. A record is
  // VOIDED with a reason (calibrationRecords.service#voidCalibrationRecord),
  // and a void is final — the database trigger refuses is_deleted true ->
  // false, so a restore could only ever fail.

  /**
   * Define associations for this model.
   * @param models - The aggregated models object
   */
  CalibrationRecord.associate = (models: Models): void => {
    // CalibrationRecord -> Tenant
    CalibrationRecord.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // CalibrationRecord -> CalibrationDevice
    CalibrationRecord.belongsTo(models.CalibrationDevice, {
      foreignKey: "deviceId",
      as: "device",
      onDelete: "RESTRICT",
    });
    // CalibrationRecord -> User (performedBy)
    CalibrationRecord.belongsTo(models.User, {
      foreignKey: "performedBy",
      as: "performer",
      onDelete: "RESTRICT",
    });
    // CalibrationRecord -> ApiKey (Q-51). ApiKey has a defaultScope: include it with required: false.
    CalibrationRecord.belongsTo(models.ApiKey, {
      foreignKey: "apiKeyId",
      as: "apiKey",
      onDelete: "RESTRICT",
    });
  };

  return CalibrationRecord;
};

export = defineModel;
