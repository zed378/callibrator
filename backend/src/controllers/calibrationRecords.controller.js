/**
 * Calibration Record controller
 */
const calibrationRecordsService = require("../services/calibrationRecords.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  getCalibrationRecordsQuery,
  calibrationRecordIdSchema,
  createCalibrationRecordSchema,
  updateCalibrationRecordSchema,
  validate: validatorValidate,
} = require("../validators/calibrationRecords.validator");

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

exports.getAllCalibrationRecords = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.query, getCalibrationRecordsQuery);
  const result = await calibrationRecordsService.fetchCalibrationRecords({
    tenantId,
    page: validated.page,
    limit: validated.limit,
    deviceId: validated.deviceId,
    isCompliant: validated.isCompliant,
    from: validated.from,
    to: validated.to,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

exports.getSpecificCalibrationRecord = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { calibrationRecordId } = validate(
    req.params,
    calibrationRecordIdSchema,
  );
  const result = await calibrationRecordsService.fetchSpecificCalibrationRecord(
    tenantId,
    calibrationRecordId,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.createCalibrationRecord = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const validated = validate(req.body, createCalibrationRecordSchema);
  const result = await calibrationRecordsService.createCalibrationRecord(
    tenantId,
    userId,
    validated,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.updateCalibrationRecord = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { calibrationRecordId } = validate(
    req.params,
    calibrationRecordIdSchema,
  );
  const validated = validate(req.body, updateCalibrationRecordSchema);
  const result = await calibrationRecordsService.updateCalibrationRecord(
    tenantId,
    calibrationRecordId,
    validated,
  );

  success(res, result.data, null, result.message, result.status);
});

exports.deleteCalibrationRecord = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { calibrationRecordId } = validate(
    req.params,
    calibrationRecordIdSchema,
  );
  const result = await calibrationRecordsService.deleteCalibrationRecord(
    tenantId,
    calibrationRecordId,
  );

  success(res, result.data, null, result.message, result.status);
});
