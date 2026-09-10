const { CalibrationDevice, IotReading, Notification } = require("../models");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");
const { Op } = require("sequelize");

class PredictiveMaintenanceService {
  /**
   * Analyze IoT data for a specific calibration device and generate a 
   * recommendation for its calibration interval.
   * 
   * @param {string} tenantId 
   * @param {string} deviceId 
   */
  async analyzeDevice(tenantId, deviceId) {
    const device = await CalibrationDevice.findOne({
      where: { id: deviceId, tenantId, iotEnabled: true },
    });

    if (!device) {
      throw new AppError(404, "IoT enabled Calibration Device not found");
    }

    if (!device.calibrationIntervalDays) {
      throw new AppError(400, "Device has no baseline calibration interval to optimize");
    }

    // Analyze the last 30 days of telemetry
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const totalReadings = await IotReading.count({
      where: { 
        deviceId, 
        tenantId,
        timestamp: { [Op.gte]: thirtyDaysAgo }
      }
    });

    if (totalReadings < 10) {
      // Not enough data
      return { status: "skipped", reason: "Not enough IoT readings in the last 30 days." };
    }

    const anomalyReadings = await IotReading.count({
      where: { 
        deviceId, 
        tenantId,
        isAnomaly: true,
        timestamp: { [Op.gte]: thirtyDaysAgo }
      }
    });

    const anomalyRate = anomalyReadings / totalReadings;
    let newInterval = device.calibrationIntervalDays;
    let reason = "";

    // Statistical rules engine
    if (anomalyRate > 0.05) {
      // > 5% anomaly rate: Device is drifting heavily. Shorten interval by 50%.
      newInterval = Math.max(1, Math.floor(device.calibrationIntervalDays * 0.5));
      reason = `High anomaly rate (${(anomalyRate * 100).toFixed(1)}%). Recommending shortening the calibration interval to ${newInterval} days to maintain accuracy and prevent critical failures.`;
    } else if (anomalyRate > 0.01) {
      // 1-5% anomaly rate: Slight drift. Shorten interval by 20%.
      newInterval = Math.max(1, Math.floor(device.calibrationIntervalDays * 0.8));
      reason = `Moderate anomaly rate (${(anomalyRate * 100).toFixed(1)}%). Recommending slightly shorter calibration interval of ${newInterval} days.`;
    } else if (anomalyRate === 0 && totalReadings > 100) {
      // 0% anomalies over a large sample: Device is extremely stable. Extend interval by 20%.
      newInterval = Math.floor(device.calibrationIntervalDays * 1.2);
      reason = `Zero anomalies detected over a large sample of readings. Device is highly stable. Recommending extending calibration interval to ${newInterval} days to reduce maintenance costs.`;
    } else {
      // Stable, no change needed.
      return { status: "unchanged", reason: "Current calibration interval is optimal based on recent readings." };
    }

    // Save the recommendation to the device
    await device.update({
      recommendedCalibrationInterval: newInterval,
      recommendationReason: reason
    });

    // Notify the tenant
    await Notification.create({
      tenantId,
      title: `Predictive Maintenance Recommendation: ${device.name}`,
      message: `We analyzed the IoT telemetry for ${device.name}. ${reason}`,
      type: "MAINTENANCE"
    });

    logger.info(`Generated predictive maintenance recommendation for device ${deviceId}`, { newInterval, reason });

    return { status: "recommended", newInterval, reason };
  }
}

module.exports = new PredictiveMaintenanceService();
