const Joi = require("joi");

exports.ssoLoginSchema = Joi.object({
  tenantCode: Joi.string().trim().min(2).max(100).required(),
});

exports.ssoSettingsSchema = Joi.object({
  sso_enabled: Joi.boolean().required(),
  sso_idp_entry_point: Joi.string().uri().allow(null, ""),
  sso_idp_entity_id: Joi.string().trim().allow(null, ""),
  sso_idp_cert: Joi.string().trim().allow(null, ""),
  sso_sp_entity_id: Joi.string().trim().allow(null, ""),
  sso_sp_callback_url: Joi.string().uri().allow(null, ""),
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
