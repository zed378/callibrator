/**
 * CalibrationDevice Model
 *
 * Tracks calibration devices with their calibration schedule.
 * Each device belongs to a tenant and can be assigned to a warehouse.
 */

/**
 * Define the CalibrationDevice model.
 * @param {import("sequelize").Sequelize} db - The Sequelize instance
 * @param {typeof import("sequelize").DataTypes} DataTypes - The Sequelize DataTypes
 * @returns {object} The defined Sequelize model
 */
// D-27 (ADR-070): every JSON column declares its shape, validated on write.
const { jsonShape } = require("../utils/jsonShape.util");
const defineModel = (db, DataTypes) => {
  const CalibrationDevice = db.define(
    "CalibrationDevice",
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
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Unique PER TENANT (D-04): UNIQUE (tenant_id, serial_number), created
      // by migration 0026 — not here, so db.sync() cannot build it before the
      // migration has checked for duplicates. It used to be `unique: true`, a
      // GLOBAL constraint: a cross-tenant existence oracle (CLAUDE.md traps).
      serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      manufacturer: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "maintenance", "retired"),
        defaultValue: "active",
      },
      locationId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "warehouses", key: "id" },
        onDelete: "SET NULL",
      },
      installationDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      nextCalibrationDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      calibrationIntervalDays: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Days between automatic recalibration",
      },
      uncertaintyBudget: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("CalibrationDevice.uncertaintyBudget") },
        allowNull: true,
        comment: "Stores parameters and formulas for measurement uncertainty budget",
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // A-29: the ingest token is stored ONLY as a hex SHA-256 hash (migration
      // 0044, which also creates its unique index — not here, see 0026). The
      // plaintext is shown once, by services/iotDevice.service.js, and never
      // stored. The hash is excluded from the defaultScope and from toJSON()
      // below, so no device response carries it.
      iotTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "SHA-256 (hex) of the IoT ingest token; the token itself is never stored",
      },
      iotTokenIssuedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      iotEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      readingTolerance: {
        type: DataTypes.JSONB,
        validate: { shape: jsonShape("CalibrationDevice.readingTolerance") },
        allowNull: true,
        comment: "Stores upper/lower bounds for anomaly detection on IoT readings",
      },
      recommendedCalibrationInterval: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "AI/Algorithmic recommendation for calibration interval in days",
      },
      recommendationReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Reason for the recommended interval change",
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "calibration_devices",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["status"] },
        { fields: ["next_calibration_date"] },
        { fields: ["is_deleted"] },
      ],
      defaultScope: {
        where: { is_deleted: false },
        attributes: { exclude: ["iotTokenHash"] }, // A-29
      },
      scopes: {
        includeDeleted: {
          where: null,
        },
      },
    },
  );

  /**
   * A-29 — the token hash never leaves the server, even from a row loaded
   * `.unscoped()` or returned by create(). Belt and braces with the
   * defaultScope exclusion above.
   * @returns {object} the plain values without `iotTokenHash`
   */
  CalibrationDevice.prototype.toJSON = function () {
    const values = { ...this.get({ plain: true }) };
    delete values.iotTokenHash;
    return values;
  };

  /**
   * Soft-delete a calibration device. Sets is_deleted = true and persists.
   */
  CalibrationDevice.prototype.softDelete = async function () {
    this.isDeleted = true;
    return this.save({ hooks: false });
  };

  /**
   * Restore a soft-deleted calibration device by ID. Sets is_deleted = false.
   */
  CalibrationDevice.restoreStatic = async function (id) {
    // `isDeleted` is the ATTRIBUTE (column is_deleted via underscored).
    // Model.update intersects its values with attribute names, so the former
    // `{ is_deleted: false }` was dropped and nothing was written (D-07).
    // unscoped(): the defaultScope pins isDeleted = false, which a restore
    // must not inherit; paranoid and the global tenant hooks still apply.
    return this.unscoped().update(
      { isDeleted: false },
      { where: { id, isDeleted: true } },
    );
  };

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  CalibrationDevice.associate = (models) => {
    // CalibrationDevice -> Tenant
    CalibrationDevice.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // CalibrationDevice -> Warehouse
    CalibrationDevice.belongsTo(models.Warehouse, {
      foreignKey: "locationId",
      as: "warehouse",
      onDelete: "SET NULL",
    });
    // CalibrationDevice -> CalibrationRecord (hasMany)
    CalibrationDevice.hasMany(models.CalibrationRecord, {
      foreignKey: "deviceId",
      as: "calibrationRecords",
      onDelete: "RESTRICT",
    });
  };

  return CalibrationDevice;
};

module.exports = defineModel;
