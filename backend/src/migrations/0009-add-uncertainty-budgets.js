"use strict";

module.exports = {
  up: async ({ context }) => {
    const { sequelize } = context;
    const DataTypes = sequelize.Sequelize.DataTypes;

    // Idempotent: skip columns db.sync() already created on a fresh DB.
    const devices = await context.describeTable("calibration_devices");
    if (!devices.uncertainty_budget) {
      await context.addColumn("calibration_devices", "uncertainty_budget", {
        type: DataTypes.JSONB,
        allowNull: true,
      });
    }

    const records = await context.describeTable("calibration_records");
    if (!records.measurement_uncertainty) {
      await context.addColumn("calibration_records", "measurement_uncertainty", {
        type: DataTypes.FLOAT,
        allowNull: true,
      });
    }
  },

  down: async ({ context }) => {
    await context.removeColumn("calibration_records", "measurement_uncertainty");
    await context.removeColumn("calibration_devices", "uncertainty_budget");
  },
};
