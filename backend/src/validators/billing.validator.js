const Joi = require("joi");

// Aligned with the Subscription model and billing.service (which reads
// `planId`, `billingCycle`, `status`): the previous `planName` field was
// silently ignored by the service, and "Yearly" did not match the model's
// "Annually" enum value.
exports.updateSubscription = Joi.object({
  planId: Joi.string().trim().max(100),
  status: Joi.string().valid("Active", "PastDue", "Canceled", "Unpaid"),
  billingCycle: Joi.string().valid("Monthly", "Annually"),
});

exports.validate = (body, schema) => {
  return schema.validate(body, {
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
