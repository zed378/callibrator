/**
 * Warehouse validation schemas
 */
const Joi = require("joi");

// ==========================================
// QUERY / PARAMS
// ==========================================

exports.getWarehousesQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  find: Joi.string().allow(null, ""),
  status: Joi.string()
    .valid("active", "inactive", "ACTIVE", "INACTIVE")
    .insensitive()
    .allow(null, ""),
});

exports.warehouseIdSchema = Joi.object({
  warehouseId: Joi.string().uuid().required(),
});

exports.locationIdSchema = Joi.object({
  locationId: Joi.string().uuid().required(),
});

// ==========================================
// WAREHOUSE CRUD
// ==========================================

exports.createWarehouseSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255).required(),
  code: Joi.string().trim().min(2).max(100).required(),
  address: Joi.string().trim().max(500).allow(null, ""),
  description: Joi.string().trim().allow(null, ""),
  status: Joi.string()
    .valid("active", "inactive", "ACTIVE", "INACTIVE")
    .default("active")
    .insensitive()
    .allow(null),
}).custom((value) => {
  if (value.status && typeof value.status === "string") {
    value.status = value.status.toLowerCase();
  }
  return value;
});

exports.updateWarehouseSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255),
  code: Joi.string().trim().min(2).max(100),
  address: Joi.string().trim().max(500).allow(null, ""),
  description: Joi.string().trim().allow(null, ""),
  status: Joi.string()
    .valid("active", "inactive", "ACTIVE", "INACTIVE")
    .insensitive()
    .allow(null),
}).custom((value) => {
  if (value.status && typeof value.status === "string") {
    value.status = value.status.toLowerCase();
  }
  return value;
});

// ==========================================
// STORAGE LOCATION CRUD
// ==========================================

exports.createLocationSchema = Joi.object({
  warehouseId: Joi.string().uuid().required(),
  name: Joi.string().trim().min(2).max(255).required(),
  code: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().allow(null, ""),
  isActive: Joi.boolean().default(true),
});

exports.updateLocationSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255),
  code: Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().allow(null, ""),
  isActive: Joi.boolean(),
});

// ==========================================
// VALIDATION HELPERS
// ==========================================

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
