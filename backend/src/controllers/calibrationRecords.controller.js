/**
 * Calibration Record controller
 */
const calibrationRecordsService = require("../services/calibrationRecords.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
// A-112: sendResult, not success() — calibrationRecords.service RETURNS its
// not-found outcomes, and success() sent them with `success: true`.
const { sendResult } = require("../utils/response.util");
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-41).
const { auditActor } = require("../utils/auditActor.util");
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

  // Rows in `data`, pagination in a top-level `meta`. A failed result carries
  // no rows; sendResult sends it down the error path and ignores the meta.
  const page = result.data || {};
  sendResult(res, { ...result, data: page.rows }, page.meta || null);
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

  sendResult(res, result);
});

exports.createCalibrationRecord = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const validated = validate(req.body, createCalibrationRecordSchema);
  const result = await calibrationRecordsService.createCalibrationRecord(
    tenantId,
    userId,
    validated,
    auditActor(req),
  );

  sendResult(res, result);
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
    auditActor(req),
  );

  sendResult(res, result);
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
    auditActor(req),
  );

  sendResult(res, result);
});
