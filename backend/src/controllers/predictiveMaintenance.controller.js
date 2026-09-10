const { Op } = require("sequelize");
const predictiveMaintenanceService = require("../services/predictiveMaintenance.service");
const { success } = require("../utils/response.util");
const { CalibrationDevice } = require("../models");
const { AppError } = require("../utils/appError.util");
const { tenantStorage } = require("../middlewares/tenantContext.middleware");

exports.analyzeDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { tenantId } = tenantStorage.getStore();

    const result = await predictiveMaintenanceService.analyzeDevice(tenantId, deviceId);
    // success(res, data, meta, message, statusCode) SENDS the response — it is
    // not a body builder. Passing the message as `res` made `res.status`
    // undefined and threw on every call.
    return success(res, result, null, "Analysis complete");
  } catch (error) {
    next(error);
  }
};

exports.getRecommendations = async (req, res, next) => {
  try {
    const { tenantId } = tenantStorage.getStore();

    const devices = await CalibrationDevice.findAll({
      where: {
        tenantId,
        // Must be Op.ne, not the Mongo-style `$ne`: Sequelize dropped string
        // operator aliases in v5, so `{ $ne: null }` was compared as a literal
        // value — `= '[object Object]'` — and 500'd with
        // "invalid input syntax for type integer".
        recommendedCalibrationInterval: {
          [Op.ne]: null,
        },
      },
      attributes: ["id", "name", "serialNumber", "calibrationIntervalDays", "recommendedCalibrationInterval", "recommendationReason"]
    });

    return success(res, devices, null, "Recommendations retrieved");
  } catch (error) {
    next(error);
  }
};

exports.approveRecommendation = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { tenantId } = tenantStorage.getStore();

    const device = await CalibrationDevice.findOne({
      where: { id: deviceId, tenantId }
    });

    if (!device) {
      throw new AppError(404, "Device not found");
    }

    if (!device.recommendedCalibrationInterval) {
      throw new AppError(400, "Device does not have a pending recommendation");
    }

    await device.update({
      calibrationIntervalDays: device.recommendedCalibrationInterval,
      recommendedCalibrationInterval: null,
      recommendationReason: null
    });

    return success(res, device, null, "Recommendation applied successfully");
  } catch (error) {
    next(error);
  }
};
