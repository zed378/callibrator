const Joi = require("joi");

exports.createRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).allow(null, ""),
});

exports.updateRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(500).allow(null, ""),
  status: Joi.string().valid("active", "inactive", "deleted"),
});

exports.createMenuSchema = Joi.object({
  // Add menu schema fields as needed
}).unknown(true);

exports.updateMenuSchema = Joi.object({
  // Add menu schema fields as needed
}).unknown(true);

exports.assignRoleSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  roleId: Joi.string().uuid().required(),
});

exports.assignPermissionSchema = Joi.object({
  menuGroupId: Joi.string().uuid().required(),
  permissionType: Joi.string().valid("read", "write").required(),
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
