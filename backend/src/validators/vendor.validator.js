const Joi = require("joi");

exports.createVendor = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  type: Joi.string().valid("CalibrationLab", "PartsSupplier", "Other").default("Other"),
  contactPerson: Joi.string().trim().max(100).allow(null, ""),
  email: Joi.string().trim().email().allow(null, ""),
  phone: Joi.string().trim().max(50).allow(null, ""),
  address: Joi.string().trim().allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  status: Joi.string().valid("Active", "Inactive").default("Active"),
});

exports.updateVendor = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  type: Joi.string().valid("CalibrationLab", "PartsSupplier", "Other"),
  contactPerson: Joi.string().trim().max(100).allow(null, ""),
  email: Joi.string().trim().email().allow(null, ""),
  phone: Joi.string().trim().max(50).allow(null, ""),
  address: Joi.string().trim().allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
  status: Joi.string().valid("Active", "Inactive"),
  rating: Joi.number().min(1).max(5).allow(null),
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
