/**
 * Tenant Hierarchy Validators
 *
 * Joi validation schemas for tenant hierarchy endpoints.
 */

const Joi = require("joi");
const { formatErrors } = require("../utils/appError.util");

/**
 * Validate sub-organization creation
 */
exports.createSubOrganization = Joi.object({
  name: Joi.string().required().min(2).max(255),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate add child tenant (alias used by routes)
 */
exports.addChild = Joi.object({
  name: Joi.string().required().min(2).max(255),
  code: Joi.string().optional().max(50),
  settings: Joi.object().optional(),
  plan: Joi.string()
    .valid("free", "professional", "business", "enterprise")
    .default("free"),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate role assignment
 */
exports.assignRole = Joi.object({
  roleId: Joi.string().uuid().required(),
  scope: Joi.string().valid("self", "subtree").default("subtree"),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Format validation errors
 */
exports.validate = (data, schema) => {
  const { error, value } = schema.validate(data);
  if (error) {
    throw new Error(formatErrors(error.details));
  }
  return value;
};
