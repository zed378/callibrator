/**
 * Calibration Record validation schemas
 */
const Joi = require("joi");

// ==========================================
// QUERY / PARAMS
// ==========================================

exports.getCalibrationRecordsQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  deviceId: Joi.string().uuid().allow(null, ""),
  isCompliant: Joi.boolean().allow(null),
  from: Joi.date().allow(null, ""),
  to: Joi.date().allow(null, ""),
  // P6-03: include records a correction has superseded (the history).
  includeSuperseded: Joi.boolean().default(false),
});

exports.calibrationRecordIdSchema = Joi.object({
  calibrationRecordId: Joi.string().uuid().required(),
});

exports.calibrationDeviceIdSchema = Joi.object({
  calibrationDeviceId: Joi.string().uuid().required(),
});

// ==========================================
// CRUD
// ==========================================

exports.createCalibrationRecordSchema = Joi.object({
  deviceId: Joi.string().uuid().required(),
  calibrationDate: Joi.date().default(Date.now),
  dueDate: Joi.date().allow(null, ""),
  standard: Joi.string().trim().max(255).allow(null, ""),
  results: Joi.object().allow(null, ""),
  isCompliant: Joi.boolean().allow(null),
  certificateNumber: Joi.string().trim().max(100).allow(null, ""),
  certificateFileUrl: Joi.string().uri().max(1024).allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
});

// P6-03 — there is no update schema. A calibration record is append-only
// (BR-7; migration 0057's trigger refuses a content change for every role).

/**
 * Why a correction or a void happened. Required, and never blank: `trim()`
 * runs before the length check, so "   " is refused as empty rather than
 * stored as a reason that says nothing.
 */
const lifecycleReason = Joi.string().trim().min(3).max(2000).required();

/**
 * POST /calibration-records/:id/corrections — the corrected content (any
 * subset; omitted fields are carried over from the original) and the reason.
 */
exports.correctCalibrationRecordSchema = Joi.object({
  deviceId: Joi.string().uuid(),
  calibrationDate: Joi.date(),
  dueDate: Joi.date().allow(null),
  standard: Joi.string().trim().max(255).allow(null, ""),
  results: Joi.object().allow(null),
  measurementUncertainty: Joi.number().allow(null),
  isCompliant: Joi.boolean().allow(null),
  certificateNumber: Joi.string().trim().max(100).allow(null, ""),
  certificateFileUrl: Joi.string().uri().max(1024).allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  reason: lifecycleReason,
});

/** POST /calibration-records/:id/void */
exports.voidCalibrationRecordSchema = Joi.object({
  reason: lifecycleReason,
});

// ==========================================
// VALIDATION HELPERS
// ==========================================

// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
exports.validate = (body, schema) => {
  return schema.validate(body ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });
};

exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
