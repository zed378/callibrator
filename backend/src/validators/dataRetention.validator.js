const Joi = require("joi");

const tenantIdSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
});

const retentionPolicySchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  policyKey: Joi.string().required(),
  days: Joi.number().integer().min(0).required(),
});

const legalHoldSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  reason: Joi.string().optional(),
});

const piiMaskSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  entityType: Joi.string().required(),
  recordIds: Joi.array().items(Joi.string().uuid()).required(),
});

const anonymizeSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  entityType: Joi.string().required(),
  options: Joi.object({
    keepDates: Joi.boolean().optional(),
    keepNumericIds: Joi.boolean().optional(),
  }).optional(),
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
  retentionPolicySchema,
  legalHoldSchema,
  piiMaskSchema,
  anonymizeSchema,
  validate,
};
