const Joi = require("joi");

// Aligned with the Subscription model and billing.service (which reads
// `planId`, `billingCycle`, `status`): the previous `planName` field was
// silently ignored by the service, and "Yearly" did not match the model's
// "Annually" enum value.
//
// A-225: `reason` explains a manual status override (the service requires it
// when the status changes); at least one updatable field must be sent.
exports.updateSubscription = Joi.object({
  planId: Joi.string().trim().max(100),
  status: Joi.string().valid("Active", "PastDue", "Canceled", "Unpaid"),
  billingCycle: Joi.string().valid("Monthly", "Annually"),
  reason: Joi.string().trim().min(3).max(500),
}).or("planId", "status", "billingCycle");

// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
exports.validate = (body, schema) => {
  return schema.validate(body ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });
};

exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
