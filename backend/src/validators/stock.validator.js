/**
 * Stock validation schemas
 */
const Joi = require("joi");

// ==========================================
// GET STOCKS QUERY
// ==========================================

exports.getStocksQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  find: Joi.string().allow(null, ""),
  warehouseId: Joi.string().uuid().allow(null, ""),
  locationId: Joi.string().uuid().allow(null, ""),
});

exports.stockIdSchema = Joi.object({
  stockId: Joi.string().uuid().required(),
});

// ==========================================
// STOCK CRUD
// ==========================================

exports.createStockSchema = Joi.object({
  warehouseId: Joi.string().uuid().required(),
  locationId: Joi.string().uuid().allow(null, ""),
  itemName: Joi.string().trim().min(2).max(255).required(),
  sku: Joi.string().trim().max(100).allow(null, ""),
  serialNumber: Joi.string().trim().max(100).allow(null, ""),
  quantity: Joi.number().integer().min(0).default(0),
  minQuantity: Joi.number().integer().min(0).default(0),
  description: Joi.string().trim().allow(null, ""),
});

exports.updateStockSchema = Joi.object({
  itemName: Joi.string().trim().min(2).max(255),
  sku: Joi.string().trim().max(100).allow(null, ""),
  serialNumber: Joi.string().trim().max(100).allow(null, ""),
  quantity: Joi.number().integer().min(0),
  minQuantity: Joi.number().integer().min(0),
  description: Joi.string().trim().allow(null, ""),
});

// ==========================================
// STOCK TRANSFER
// ==========================================

exports.createTransferSchema = Joi.object({
  fromWarehouseId: Joi.string().uuid().required(),
  toWarehouseId: Joi.string().uuid().required(),
  itemName: Joi.string().trim().min(2).max(255).required(),
  quantity: Joi.number().integer().min(1).required(),
  notes: Joi.string().trim().allow(null, ""),
});

exports.updateTransferStatusSchema = Joi.object({
  status: Joi.string()
    .valid("pending", "in_transit", "completed", "cancelled")
    .required(),
});

// ==========================================
// STOCK ADJUSTMENT
// ==========================================

exports.createAdjustmentSchema = Joi.object({
  stockId: Joi.string().uuid().required(),
  type: Joi.string().valid("addition", "subtraction", "write_off").required(),
  quantity: Joi.number().integer().min(1).required(),
  reason: Joi.string().trim().max(255).allow(null, ""),
});

// ==========================================
// STOCK OPNAME
// ==========================================

exports.createOpnameSchema = Joi.object({
  warehouseId: Joi.string().uuid().required(),
  scheduledAt: Joi.date().iso().required(),
  notes: Joi.string().trim().allow(null, ""),
});

exports.updateOpnameStatusSchema = Joi.object({
  status: Joi.string().valid("draft", "in_progress", "completed").required(),
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
