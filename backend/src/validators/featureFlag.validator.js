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

const validate = (data, schema) => {
  const { error, value } = schema.validate(data, {
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
