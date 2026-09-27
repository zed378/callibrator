const Joi = require("joi");

exports.createVendor = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  type: Joi.string().valid("CalibrationLab", "PartsSupplier", "Other").default("Other"),
  contactPerson: Joi.string().trim().max(100).allow(null, ""),
  email: Joi.string().trim().email().allow(null, ""),
  phone: Joi.string().trim().max(50).allow(null, ""),
  address: Joi.string().trim().allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
});

exports.updateVendor = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  type: Joi.string().valid("CalibrationLab", "PartsSupplier", "Other"),
  contactPerson: Joi.string().trim().max(100).allow(null, ""),
  email: Joi.string().trim().email().allow(null, ""),
  phone: Joi.string().trim().max(50).allow(null, ""),
  address: Joi.string().trim().allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  status: Joi.string().valid("Active", "Inactive"),
  rating: Joi.number().min(1).max(5).allow(null),
});

// P6-02 — PATCH /vendors/:vendorId/qualify had no validator. The column is a
// PostgreSQL enum of UPPER-CASE values, and the frontend sends "approved" /
// "rejected" (VendorsTable.tsx), so every approve or reject reached the
// database as an invalid enum value and answered 500. The value is matched
// case-insensitively and stored in the enum's case; anything else is a 400.
exports.qualifyVendor = Joi.object({
  approvalStatus: Joi.string()
    .trim()
    .uppercase()
    .valid("APPROVED", "PENDING", "REJECTED", "CONDITIONAL"),
  scorecard: Joi.number().integer().min(0).max(100).allow(null),
  lastAuditDate: Joi.date().iso().allow(null),
  nextAuditDate: Joi.date().iso().allow(null),
});

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
