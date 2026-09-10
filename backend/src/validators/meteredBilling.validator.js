/**
 * Metered Billing Validators
 *
 * Joi validation schemas for metered billing endpoints.
 */

const Joi = require("joi");
const { formatErrors } = require("../utils/appError.util");

/**
 * Validate usage alert creation
 */
exports.createUsageAlert = Joi.object({
  metricName: Joi.string().required(),
  threshold: Joi.number().positive().required(),
  comparison: Joi.string().valid("gte", "lte", "eq", "gt", "lt").default("gte"),
  notificationChannels: Joi.array()
    .items(Joi.string().valid("email", "webhook"))
    .default(["email"]),
  isEnabled: Joi.boolean().default(true),
  description: Joi.string().allow("").default(""),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate cost estimation request
 */
exports.estimateCost = Joi.object({
  metrics: Joi.object().required(),
  quantity: Joi.number().integer().positive().required(),
  period: Joi.string()
    .valid("hourly", "daily", "monthly", "yearly")
    .default("monthly"),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate analytics period
 */
exports.getAnalytics = Joi.object({
  period: Joi.string().valid("7d", "30d", "90d", "1y").default("30d"),
  metrics: Joi.array().items(Joi.string()).optional(),
}).options({ abortEarly: false, stripUnknown: true });

/**
 * Validate billing history query
 */
exports.getBillingHistory = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  startDate: Joi.date().optional(),
  endDate: Joi.date()
    .optional()
    .min(Joi.ref("startDate"))
    .message("endDate must be after startDate"),
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

/**
 * Express middleware factory that validates a request `source` (body/query)
 * against a Joi schema. The Joi schemas above are NOT Express middleware — their
 * `.validate` is Joi's `(value, options)` method — so routes must wrap them here.
 */
const validateSource = (schema, source, reassign) => (req, res, next) => {
  const { error, value } = schema.validate(req[source] || {});
  if (error) {
    const err = new Error(formatErrors(error.details));
    err.status = 400;
    err.statusCode = 400;
    return next(err);
  }
  if (reassign) {
    // req.query is a read-only getter in Express 5; body is safe to normalize.
    try {
      req[source] = value;
    } catch {
      /* ignore read-only source */
    }
  }
  next();
};

exports.validateBody = (schema) => validateSource(schema, "body", true);
exports.validateQuery = (schema) => validateSource(schema, "query", false);
