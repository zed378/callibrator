const Joi = require("joi");

exports.createBackupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).allow(null, ""),
  backupType: Joi.string().valid("FULL", "PARTIAL", "USER_ONLY").default("FULL"),
  retentionDays: Joi.number().integer().min(1).max(365).default(90),
  tag: Joi.string().trim().max(50).allow(null, ""),
});

exports.restoreBackupSchema = Joi.object({
  mergeData: Joi.boolean().default(false),
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
