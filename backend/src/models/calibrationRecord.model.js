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
        onDelete: "CASCADE",
      },
      deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "calibration_devices", key: "id" },
        onDelete: "CASCADE",
      },
      performedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
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

  /**
   * Soft-delete a calibration record. Sets is_deleted = true and persists.
   */
  CalibrationRecord.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted calibration record by ID. Sets is_deleted = false.
   */
  CalibrationRecord.restoreStatic = async function (id) {
    return this.update(
      { is_deleted: false },
      { where: { id, is_deleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  CalibrationRecord.associate = (models) => {
    // CalibrationRecord -> Tenant
    CalibrationRecord.belongsTo(models.Tenant, {
      foreignKey: "tenant_id",
      as: "tenant",
    });
    // CalibrationRecord -> CalibrationDevice
    CalibrationRecord.belongsTo(models.CalibrationDevice, {
      foreignKey: "device_id",
      as: "device",
    });
    // CalibrationRecord -> User (performedBy)
    CalibrationRecord.belongsTo(models.User, {
      foreignKey: "performed_by",
      as: "performer",
    });
  };

  return CalibrationRecord;
};

module.exports = defineModel;
