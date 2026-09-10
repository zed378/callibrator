/**
 * Calibration Device validation schemas
 */
const Joi = require("joi");

// ==========================================
// QUERY / PARAMS
// ==========================================

exports.getCalibrationDevicesQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  find: Joi.string().allow(null, ""),
  status: Joi.string()
    .valid("active", "inactive", "maintenance", "retired")
    .insensitive()
    .allow(null, ""),
  category: Joi.string().allow(null, ""),
});

exports.calibrationDeviceIdSchema = Joi.object({
  calibrationDeviceId: Joi.string().uuid().required(),
});

// ==========================================
// CRUD
// ==========================================

exports.createCalibrationDeviceSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255).required(),
  serialNumber: Joi.string().trim().max(100).allow(null, ""),
  manufacturer: Joi.string().trim().max(255).allow(null, ""),
  model: Joi.string().trim().max(255).allow(null, ""),
  category: Joi.string().trim().max(100).allow(null, ""),
  status: Joi.string()
    .valid("active", "inactive", "maintenance", "retired")
    .default("active")
    .insensitive(),
  locationId: Joi.string().uuid().allow(null, ""),
  installationDate: Joi.date().allow(null, ""),
  nextCalibrationDate: Joi.date().allow(null, ""),
  calibrationIntervalDays: Joi.number().integer().min(1).allow(null, ""),
  remarks: Joi.string().trim().allow(null, ""),
});

exports.updateCalibrationDeviceSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255),
  serialNumber: Joi.string().trim().max(100).allow(null, ""),
  manufacturer: Joi.string().trim().max(255).allow(null, ""),
  model: Joi.string().trim().max(255).allow(null, ""),
  category: Joi.string().trim().max(100).allow(null, ""),
  status: Joi.string()
    .valid("active", "inactive", "maintenance", "retired")
    .insensitive()
    .allow(null),
  locationId: Joi.string().uuid().allow(null, ""),
  installationDate: Joi.date().allow(null, ""),
  nextCalibrationDate: Joi.date().allow(null, ""),
  calibrationIntervalDays: Joi.number().integer().min(1).allow(null, ""),
  remarks: Joi.string().trim().allow(null, ""),
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
