const Joi = require("joi");

exports.ssoLoginSchema = Joi.object({
  tenantCode: Joi.string().trim().min(2).max(100).required(),
});

// A-60: the one-time code the SSO callback puts in its redirect — 32 random
// bytes, base64url, so exactly 43 characters of [A-Za-z0-9_-]. Anything else
// cannot be a code this server issued and is refused before any store lookup.
exports.ssoExchangeSchema = Joi.object({
  code: Joi.string()
    .length(43)
    .pattern(/^[A-Za-z0-9_-]+$/)
    .required(),
});

exports.ssoSettingsSchema = Joi.object({
  sso_enabled: Joi.boolean().required(),
  sso_idp_entry_point: Joi.string().uri().allow(null, ""),
  sso_idp_entity_id: Joi.string().trim().allow(null, ""),
  sso_idp_cert: Joi.string().trim().allow(null, ""),
  sso_sp_entity_id: Joi.string().trim().allow(null, ""),
  sso_sp_callback_url: Joi.string().uri().allow(null, ""),
});

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
