const Joi = require("joi");

const tenantIdSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
});

const suspendTenantSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  reason: Joi.string().required(),
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
  tenantIdSchema,
  suspendTenantSchema,
  validate,
};
