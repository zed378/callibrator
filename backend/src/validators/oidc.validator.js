const Joi = require("joi");

const oidcClientSchema = Joi.object({
  name: Joi.string().required(),
  redirectUris: Joi.array().items(Joi.string().uri()).required(),
  scopes: Joi.array().items(Joi.string()).default(["openid", "profile", "email"]),
  grantTypes: Joi.array().items(Joi.string()).default(["authorization_code"]),
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
  oidcClientSchema,
  validate,
};
