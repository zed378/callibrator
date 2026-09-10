const Joi = require("joi");

const scimUserSchema = Joi.object({
  userName: Joi.string().email().required(),
  name: Joi.object({
    givenName: Joi.string().optional(),
    familyName: Joi.string().optional(),
  }).optional(),
  emails: Joi.array().items(Joi.object({
    value: Joi.string().email().required(),
    type: Joi.string().optional(),
    primary: Joi.boolean().optional(),
  })).optional(),
  active: Joi.boolean().optional(),
  roleId: Joi.string().uuid().optional(),
});

const scimGroupSchema = Joi.object({
  displayName: Joi.string().required(),
  members: Joi.array().items(Joi.object({
    value: Joi.string().uuid().required(),
    display: Joi.string().optional(),
  })).optional(),
});

const scimPatchSchema = Joi.object({
  Operations: Joi.array().items(Joi.object({
    op: Joi.string().valid("add", "remove", "replace").required(),
    path: Joi.string().optional(),
    value: Joi.alternatives().try(
      Joi.object(),
      Joi.array(),
      Joi.string(),
    ).optional(),
  })).required(),
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
  scimUserSchema,
  scimGroupSchema,
  scimPatchSchema,
  validate,
};
