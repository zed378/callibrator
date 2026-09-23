const Joi = require("joi");

const ipAllowlistSchema = Joi.object({
  cidrs: Joi.array().items(Joi.string().pattern(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/)).required(),
});

const geofenceSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  radiusKm: Joi.number().positive().optional(),
});

const evaluateLoginSchema = Joi.object({
  ip: Joi.string().ip().required(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
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
  ipAllowlistSchema,
  geofenceSchema,
  evaluateLoginSchema,
  validate,
};
