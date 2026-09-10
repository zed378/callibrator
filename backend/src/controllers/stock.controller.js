// src/controllers/stock.controller.js
const stockService = require("../services/stock.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  getStocksQuery,
  stockIdSchema,
  createStockSchema,
  updateStockSchema,
  createTransferSchema,
  updateTransferStatusSchema,
  createAdjustmentSchema,
  createOpnameSchema,
  updateOpnameStatusSchema,
  validate: validatorValidate,
  formatErrors,
} = require("../validators/stock.validator");

const validate = (data, schema) => {
  const { error, value } = validatorValidate(data, schema);
  if (error) {
    throw {
      status: 400,
      message: "Validation failed",
      errors: formatErrors(error.details),
    };
  }
  return value;
};

exports.getAllStocks = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.query, getStocksQuery);
  const result = await stockService.fetchStocks({
    tenantId,
    warehouseId: validated.warehouseId,
    locationId: validated.locationId,
    find: validated.find,
    page: validated.page,
    limit: validated.limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

exports.getSpecificStock = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { stockId } = validate(req.params, stockIdSchema);
  const result = await stockService.fetchSpecificStock(tenantId, stockId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.createStock = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.body, createStockSchema);
  const result = await stockService.createStock(tenantId, validated);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.updateStock = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { stockId } = validate(req.params, stockIdSchema);
  const validated = validate(req.body, updateStockSchema);
  const result = await stockService.updateStock(tenantId, stockId, validated);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.deleteStock = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { stockId } = validate(req.params, stockIdSchema);
  const result = await stockService.deleteStock(tenantId, stockId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

// ==========================================
// ADJUSTMENT HANDLERS
// ==========================================

exports.createAdjustment = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const validated = validate(req.body, createAdjustmentSchema);
  const result = await stockService.createAdjustment(tenantId, validated, userId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.getAdjustments = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await stockService.fetchAdjustments({
    tenantId,
    warehouseId: req.query.warehouseId,
    type: req.query.type,
    page: req.query.page,
    limit: req.query.limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

// ==========================================
// TRANSFER HANDLERS
// ==========================================

exports.createTransfer = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const validated = validate(req.body, createTransferSchema);
  const result = await stockService.createTransfer(tenantId, validated, userId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.updateTransferStatus = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const { transferId } = req.params;
  const validated = validate(req.body, updateTransferStatusSchema);
  const result = await stockService.updateTransferStatus(tenantId, transferId, validated, userId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.getTransfers = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await stockService.fetchTransfers({
    tenantId,
    fromWarehouseId: req.query.fromWarehouseId,
    toWarehouseId: req.query.toWarehouseId,
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

// ==========================================
// OPNAME HANDLERS
// ==========================================

exports.createOpname = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const validated = validate(req.body, createOpnameSchema);
  const result = await stockService.createOpname(tenantId, validated, userId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.updateOpnameStatus = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.id;
  const { opnameId } = req.params;
  const validated = validate(req.body, updateOpnameStatusSchema);
  const result = await stockService.updateOpnameStatus(tenantId, opnameId, validated, userId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.getOpnames = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await stockService.fetchOpnames({
    tenantId,
    warehouseId: req.query.warehouseId,
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  });

  success(
    res,
    result.data.rows,
    result.data.meta,
    result.message,
    result.status,
  );
});

exports.getInventoryReport = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await stockService.getInventoryReport(tenantId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.exportInventoryCsv = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const result = await stockService.exportInventoryCsv(tenantId);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=inventory_report.csv");
  res.status(result.status).send(result.data);
});
