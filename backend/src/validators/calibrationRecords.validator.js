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

exports.updateCalibrationRecordSchema = Joi.object({
  deviceId: Joi.string().uuid(),
  calibrationDate: Joi.date(),
  dueDate: Joi.date().allow(null, ""),
  standard: Joi.string().trim().max(255).allow(null, ""),
  results: Joi.object().allow(null, ""),
  isCompliant: Joi.boolean().allow(null),
  certificateNumber: Joi.string().trim().max(100).allow(null, ""),
  certificateFileUrl: Joi.string().uri().max(1024).allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
});

// ==========================================
// VALIDATION HELPERS
// ==========================================

exports.validate = (body, schema) => {
  return schema.validate(body, {
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
