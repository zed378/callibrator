const { AppError } = require("../utils/appError.util");
const { success } = require("../utils/response.util");
const { CalibrationDevice } = require("../models");
const iotService = require("../services/iot.service");

exports.ingestHttp = async (req, res, next) => {
  try {
    const token = req.headers["x-iot-token"] || req.body.token;

    if (!token) {
      throw new AppError(401, "IoT Device Token is required");
    }

    const payload = req.body.payload;
    if (!payload || typeof payload !== "object") {
      throw new AppError(400, "Payload object is required");
    }

    // Authenticate device
    const device = await CalibrationDevice.unscoped().findOne({
      where: { iotDeviceToken: token, iotEnabled: true },
      attributes: ["id", "tenantId"]
    });

    if (!device) {
      throw new AppError(401, "Invalid IoT Device Token or IoT is disabled for this device");
    }

    const result = await iotService.ingestReading(device.tenantId, device.id, payload);

    // success(res, data, meta, message, statusCode) sends the response itself.
    // This previously passed the message as `res`, so `res.status` was
    // undefined and every successful ingest threw a TypeError into next().
    return success(res, result, null, "Reading ingested successfully");
  } catch (err) {
    next(err);
  }
};
