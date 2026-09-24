/**
 * IotReading Model
 *
 * Stores time-series telemetry data from IoT calibration devices.
 */

const defineModel = (db, DataTypes) => {
  const IotReading = db.define(
    "IotReading",
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
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      metrics: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: "Stores the telemetry readings (e.g. { temperature: 22, humidity: 45 })",
      },
      isAnomaly: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
    },
    {
      tableName: "iot_readings",
      timestamps: true,
      updatedAt: false, // Immutable timeseries data
      underscored: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["device_id"] },
        { fields: ["timestamp"] },
        { fields: ["device_id", "timestamp"] },
        // D-19 (migration 0067 creates the same names on an existing
        // database): a device's telemetry window inside its tenant, and the
        // tenant time range the retention purge deletes by.
        { fields: ["tenant_id", "device_id", "timestamp"] },
        { fields: ["tenant_id", "timestamp"] },
      ],
    }
  );

  /**
   * Define associations for this model.
   * @param {object} models - The aggregated models object
   */
  IotReading.associate = (models) => {
    // IotReading -> Tenant
    IotReading.belongsTo(models.Tenant, {
      foreignKey: "tenantId",
      as: "tenant",
      onDelete: "RESTRICT",
    });
    // IotReading -> CalibrationDevice
    IotReading.belongsTo(models.CalibrationDevice, {
      foreignKey: "deviceId",
      as: "device",
      onDelete: "RESTRICT",
    });
  };

  return IotReading;
};

module.exports = defineModel;
