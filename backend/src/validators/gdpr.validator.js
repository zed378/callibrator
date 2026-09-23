/**
 * GDPR/CCPA Validators
 *
 * Joi validation schemas for privacy compliance endpoints.
 */

const Joi = require("joi");
const { formatErrors } = require("../utils/appError.util");

/**
 * Validate erasure request
 */
exports.requestErasure = Joi.object({
  reason: Joi.string().required().max(500),
  confirm: Joi.boolean().valid(true).required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate consent update
 */
exports.updateConsent = Joi.object({
  categories: Joi.array()
    .items(
      Joi.string().valid("analytics", "marketing", "functional", "necessary"),
    )
    .required(),
  consent: Joi.boolean().required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate data rectification
 */
exports.rectifyData = Joi.object({
  field: Joi.string().required().max(100),
  value: Joi.required(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate processing restriction
 */
exports.restrictProcessing = Joi.object({
  reason: Joi.string().required().max(500),
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
