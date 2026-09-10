const Joi = require("joi");

exports.revokeSessionSchema = Joi.object({
  reason: Joi.string().trim().max(255).default("MANUAL_REVOKE"),
});

exports.revokeAllSessionsSchema = Joi.object({
  reason: Joi.string().trim().max(255).default("ADMIN_REVOKE_ALL"),
});

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
