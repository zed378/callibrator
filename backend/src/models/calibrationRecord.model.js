/**
 * CalibrationRecord Model
 *
 * Tracks calibration history for devices.
 * Each record contains calibration results, compliance status,
 * and certificate information.
 */

/**
 * Define the CalibrationRecord model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const { jsonShape } = require("../utils/jsonShape.util");
const defineModel = (db, DataTypes) => {
  const CalibrationRecord = db.define(
    "CalibrationRecord",
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
      performedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        // RESTRICT (F-6, ADR-051 Q-16): hard-deleting the performer must not
        // delete the calibration record, nor erase who performed it.
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
        comment: "Calculated measurement uncertainty for this calibration record",
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
        comment: "On a correction: why the original was wrong (required with supersedesId)",
      },
      supersededById: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "calibration_records", key: "id" },
        onDelete: "RESTRICT",
        comment: "On a corrected record: the correction that replaced it (set once)",
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
        { fields: ["calibration_date"] },
        { fields: ["is_compliant"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        where: { is_deleted: false },
      },
      scopes: {
        includeDeleted: {
          where: null,
        },
      },
    },
  );

  // P6-03: there is no softDelete() and no restoreStatic() here. A record is
  // VOIDED with a reason (calibrationRecords.service#voidCalibrationRecord),
  // and a void is final — the database trigger refuses is_deleted true ->
  // false, so a restore could only ever fail.

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  CalibrationRecord.associate = (models) => {
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
  };

  return CalibrationRecord;
};

module.exports = defineModel;
