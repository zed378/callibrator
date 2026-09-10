module.exports = {
  up: async ({ context: queryInterface }) => {
    const { DataTypes } = require("sequelize");

    // Add IoT fields to calibration_devices
    // Check if column exists to avoid errors on retry
    const tableDesc = await queryInterface.describeTable("calibration_devices");
    
    if (!tableDesc.iot_device_token) {
        await queryInterface.addColumn("calibration_devices", "iot_device_token", {
          type: DataTypes.STRING(255),
          allowNull: true,
          unique: true,
        });
    }

    if (!tableDesc.iot_enabled) {
        await queryInterface.addColumn("calibration_devices", "iot_enabled", {
          type: DataTypes.BOOLEAN,
          defaultValue: false,
          allowNull: false,
        });
    }

    if (!tableDesc.reading_tolerance) {
        await queryInterface.addColumn("calibration_devices", "reading_tolerance", {
          type: DataTypes.JSONB,
          allowNull: true,
        });
    }

    if (!tableDesc.recommended_calibration_interval) {
        await queryInterface.addColumn("calibration_devices", "recommended_calibration_interval", {
          type: DataTypes.INTEGER,
          allowNull: true,
        });
    }

    if (!tableDesc.recommendation_reason) {
        await queryInterface.addColumn("calibration_devices", "recommendation_reason", {
          type: DataTypes.TEXT,
          allowNull: true,
        });
    }
  },

  down: async ({ context: queryInterface }) => {
    // Only removing columns
    await queryInterface.removeColumn("calibration_devices", "iot_device_token");
    await queryInterface.removeColumn("calibration_devices", "iot_enabled");
    await queryInterface.removeColumn("calibration_devices", "reading_tolerance");
    await queryInterface.removeColumn("calibration_devices", "recommended_calibration_interval");
    await queryInterface.removeColumn("calibration_devices", "recommendation_reason");
  },
};
