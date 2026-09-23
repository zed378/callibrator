const { AppError } = require("../utils/appError.util");
const { success } = require("../utils/response.util");
const { CalibrationDevice } = require("../models");
const iotService = require("../services/iot.service");

exports.ingestHttp = async (req, res, next) => {
  try {
    // A-09: ingest is a public endpoint — a POST with no body at all left
    // `req.body` undefined under Express 5, so reading `.token` off it threw a
    // TypeError and the unauthenticated caller got a 500 instead of a 401.
    const { token: bodyToken, payload } = req.body || {};
    const token = req.headers["x-iot-token"] || bodyToken;

    if (!token) {
      throw new AppError(401, "IoT Device Token is required");
    }

    if (!payload || typeof payload !== "object") {
      throw new AppError(400, "Payload object is required");
    }

    // Authenticate device
    // `.unscoped()` is required to cross tenants — ingest arrives with a device
    // token, not a session — but it also drops the defaultScope, which is what
    // excludes soft-deleted rows. A decommissioned device kept ingesting, so
    // the predicate is carried explicitly.
    const device = await CalibrationDevice.unscoped().findOne({
      where: { iotDeviceToken: token, iotEnabled: true, isDeleted: false },
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
