const Joi = require("joi");

exports.createAssetFinance = Joi.object({
  deviceId: Joi.string().uuid().required(),
  purchasePrice: Joi.number().min(0).required(),
  purchaseDate: Joi.date().iso().required(),
  salvageValue: Joi.number().min(0).default(0),
  usefulLifeYears: Joi.number().integer().min(1).max(50).required(),
  depreciationMethod: Joi.string()
    .valid("straight_line", "declining_balance")
    .default("straight_line"),
  vendorId: Joi.string().uuid().allow(null),
  invoiceNumber: Joi.string().trim().max(100).allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
});

exports.updateAssetFinance = Joi.object({
  purchasePrice: Joi.number().min(0),
  purchaseDate: Joi.date().iso(),
  salvageValue: Joi.number().min(0),
  usefulLifeYears: Joi.number().integer().min(1).max(50),
  depreciationMethod: Joi.string().valid("straight_line", "declining_balance"),
  vendorId: Joi.string().uuid().allow(null),
  invoiceNumber: Joi.string().trim().max(100).allow(null, ""),
  notes: Joi.string().trim().allow(null, ""),
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
