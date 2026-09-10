const Joi = require("joi");

// ==========================================
// COMMON SCHEMAS
// ==========================================

// ==========================================
// SCHEMA DEFINITIONS
// ==========================================

// Bulk delete: an explicit, non-empty list of notification ids. Ids the caller
// cannot see are filtered out by the service's recipient scope, so this only
// guards the payload shape.
exports.deleteManySchema = Joi.object({
  ids: Joi.array()
    .items(Joi.string().uuid())
    .min(1)
    .max(500)
    .required()
    .messages({
      "array.min": "Select at least one notification to delete",
      "any.required": "ids is required",
    }),
}).options({ abortEarly: false, stripUnknown: true });

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
