/**
 * Calibration Device controller
 */
const calibrationDevicesService = require("../services/calibrationDevices.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  getCalibrationDevicesQuery,
  calibrationDeviceIdSchema,
  createCalibrationDeviceSchema,
  updateCalibrationDeviceSchema,
  validate: validatorValidate,
} = require("../validators/calibrationDevices.validator");

const validate = (data, schema) => {
  const { error, value } = validatorValidate(data, schema);
  if (error) {
    throw {
      status: 400,
      message: "Validation failed",
      errors: error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      })),
    };
  }
  return value;
};

exports.getAllCalibrationDevices = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const validated = validate(req.query, getCalibrationDevicesQuery);
  const result = await calibrationDevicesService.fetchCalibrationDevices({
    tenantId,
    find: validated.find,
    page: validated.page,
    limit: validated.limit,
    status: validated.status,
    category: validated.category,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

exports.getSpecificCalibrationDevice = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const result = await calibrationDevicesService.fetchSpecificCalibrationDevice(
    tenantId,
    calibrationDeviceId,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.createCalibrationDevice = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const validated = validate(req.body, createCalibrationDeviceSchema);
  const result = await calibrationDevicesService.createCalibrationDevice(
    tenantId,
    validated,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.updateCalibrationDevice = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const validated = validate(req.body, updateCalibrationDeviceSchema);
  const result = await calibrationDevicesService.updateCalibrationDevice(
    tenantId,
    calibrationDeviceId,
    validated,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.deleteCalibrationDevice = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const { calibrationDeviceId } = validate(
    req.params,
    calibrationDeviceIdSchema,
  );
  const result = await calibrationDevicesService.deleteCalibrationDevice(
    tenantId,
    calibrationDeviceId,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.bulkImportCalibrationDevices = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;

  if (!req.file) {
    throw {
      status: 400,
      message: "No CSV file uploaded",
    };
  }

  const fs = require("fs");
  try {
    const result = await calibrationDevicesService.bulkImportCalibrationDevices(
      tenantId,
      req.file.path,
    );

    success(res, result.data, null, result.message, result.status);
  } finally {
    fs.unlink(req.file.path, (err) => {
      if (err && err.code !== "ENOENT") {
        console.error(`Failed to delete temp import file: ${req.file.path}`, err);
      }
    });
  }
});
