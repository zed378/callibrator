const { AppError } = require("../utils/appError.util");
const { success, error } = require("../utils/response.util");
const { CalibrationDevice } = require("../models");
const iotService = require("../services/iot.service");
const iotDeviceService = require("../services/iotDevice.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { auditActor } = require("../utils/auditActor.util");
const {
  deviceIdSchema,
  updateIotConfigSchema,
  validate,
} = require("../validators/iot.validator");

exports.ingestHttp = async (req, res, next) => {
  try {
    // A-09: ingest is a public endpoint — a POST with no body at all left
    // `req.body` undefined under Express 5, so reading `.token` off it threw a
    // TypeError and the unauthenticated caller got a 500 instead of a 401.
    const { token: bodyToken, payload } = req.body || {};
    const token = req.headers["x-iot-token"] || bodyToken;

    // A non-string (a JSON object or array in the body) is no token at all:
    // hashing it would throw a 500 on an unauthenticated endpoint.
    if (!token || typeof token !== "string") {
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
      // A-29: tokens are stored only as their SHA-256 hash (migration 0044).
      where: {
        iotTokenHash: iotDeviceService.hashIotToken(token),
        iotEnabled: true,
        isDeleted: false,
      },
      attributes: ["id", "tenantId"],
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

// ------------------------------------------------------------------
// Device provisioning (A-29, A-46) — /api/v1/iot/devices/:deviceId
// ------------------------------------------------------------------

/**
 * Validate `data`, or send the 400 and return null.
 * @param {import("express").Response} res - the response
 * @param {*} data - the input
 * @param {import("joi").Schema} schema - the schema
 * @returns {object|null} the validated value
 */
const validOr400 = (res, data, schema) => {
  const { error: invalid, value } = validate(data, schema);
  if (invalid) {
    error(
      res,
      "Validation failed",
      400,
      invalid.details.map((d) => ({ field: d.path.join("."), message: d.message })),
    );
    return null;
  }
  return value;
};

/**
 * Send a service result down the path its status belongs on: a 404 or 409 is
 * `success: false` with its explanation as the message.
 * @param {import("express").Response} res - the response
 * @param {{status: number, message: string, data: *}} result - the service result
 * @returns {*} the sent response
 */
const send = (res, result) =>
  result.status >= 400
    ? error(res, result.message, result.status)
    : success(res, result.data, null, result.message, result.status);

/**
 * Wrap a provisioning handler: validate the path, resolve the tenant, and send
 * what `run(tenantId, deviceId, req, res)` returns (null: already answered).
 * @param {Function} run - the service call
 * @returns {Function} the Express handler
 */
const deviceHandler = (run) =>
  asyncHandler(async (req, res) => {
    const params = validOr400(res, req.params, deviceIdSchema);
    if (!params) {
      return undefined;
    }
    const tenantId = req.tenantId || req.user.tenantId;
    const result = await run(tenantId, params.deviceId, req, res);
    return result ? send(res, result) : undefined;
  });

exports.getDeviceIotConfig = deviceHandler((tenantId, deviceId) =>
  iotDeviceService.getIotConfig(tenantId, deviceId),
);

exports.updateDeviceIotConfig = deviceHandler((tenantId, deviceId, req, res) => {
  const input = validOr400(res, req.body, updateIotConfigSchema);
  return input
    ? iotDeviceService.updateIotConfig(tenantId, deviceId, input, auditActor(req))
    : null;
});

exports.issueDeviceToken = deviceHandler((tenantId, deviceId, req) =>
  iotDeviceService.issueToken(tenantId, deviceId, auditActor(req)),
);

exports.revokeDeviceToken = deviceHandler((tenantId, deviceId, req) =>
  iotDeviceService.revokeToken(tenantId, deviceId, auditActor(req)),
);
