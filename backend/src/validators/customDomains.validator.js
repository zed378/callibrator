/**
 * Custom Domains Validators
 *
 * Joi validation schemas for custom domain endpoints.
 */

const Joi = require("joi");
const { formatErrors } = require("../utils/appError.util");

/**
 * Validate domain addition
 */
exports.addDomain = Joi.object({
  domain: Joi.string().hostname().required().messages({
    "string.hostname": "Must be a valid hostname",
    "any.required": "Domain is required",
  }),
  type: Joi.string()
    .valid("subdomain", "custom", "vanity")
    .default("subdomain"),
  sslEnabled: Joi.boolean().default(true),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate domain type
 */
exports.domainType = Joi.object({
  type: Joi.string().valid("subdomain", "custom", "vanity").required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Format validation errors
 */
// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
exports.validate = (data, schema) => {
  const { error, value } = schema.validate(data ?? {});
  if (error) {
    throw new Error(formatErrors(error.details));
  }
  return value;
};
