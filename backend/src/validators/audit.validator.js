const Joi = require("joi");

// ==========================================
// COMMON SCHEMAS
// ==========================================

// ==========================================
// SCHEMA DEFINITIONS
// ==========================================

// Audit endpoints are read-only and do not require payload validation

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
