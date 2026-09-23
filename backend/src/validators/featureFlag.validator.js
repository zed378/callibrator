const Joi = require("joi");

const flagKeySchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  flagKey: Joi.string().required(),
});

const flagValueSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  flagKey: Joi.string().required(),
  enabled: Joi.boolean().required(),
});

const tenantFlagQuerySchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
});

// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
const validate = (data, schema) => {
  const { error, value } = schema.validate(data ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = {};
    error.details.forEach((detail) => {
      errors[detail.path[0]] = detail.message;
    });
    throw {
      status: 400,
      message: "Validation failed",
      errors,
    };
  }

  return value;
};

module.exports = {
  flagKeySchema,
  flagValueSchema,
  tenantFlagQuerySchema,
  validate,
};
