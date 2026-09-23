const Joi = require("joi");

exports.revokeSessionSchema = Joi.object({
  reason: Joi.string().trim().max(255).default("MANUAL_REVOKE"),
});

exports.revokeAllSessionsSchema = Joi.object({
  reason: Joi.string().trim().max(255).default("ADMIN_REVOKE_ALL"),
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
