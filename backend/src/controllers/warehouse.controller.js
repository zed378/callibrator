// src/controllers/warehouse.controller.js
const warehouseService = require("../services/warehouse.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const {
  getWarehousesQuery,
  warehouseIdSchema,
  locationIdSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  createLocationSchema,
  updateLocationSchema,
  validate: validatorValidate,
  formatErrors,
} = require("../validators/warehouse.validator");

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

exports.getAllWarehouses = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.query, getWarehousesQuery);
  const result = await warehouseService.fetchWarehouses({
    tenantId,
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

exports.getSpecificWarehouse = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const result = await warehouseService.fetchSpecificWarehouse(tenantId, warehouseId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.createWarehouse = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.body, createWarehouseSchema);
  const result = await warehouseService.createWarehouse(tenantId, validated);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.updateWarehouse = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const validated = validate(req.body, updateWarehouseSchema);
  const result = await warehouseService.updateWarehouse(tenantId, warehouseId, validated);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.deleteWarehouse = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const result = await warehouseService.deleteWarehouse(tenantId, warehouseId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

// ==========================================
// STORAGE LOCATION HANDLERS
// ==========================================

exports.getLocations = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { warehouseId } = validate(req.params, warehouseIdSchema);
  const result = await warehouseService.fetchLocations(tenantId, warehouseId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.createLocation = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const validated = validate(req.body, createLocationSchema);
  const result = await warehouseService.createLocation(tenantId, validated);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.updateLocation = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { locationId } = validate(req.params, locationIdSchema);
  const validated = validate(req.body, updateLocationSchema);
  const result = await warehouseService.updateLocation(tenantId, locationId, validated);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});

exports.deleteLocation = asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { locationId } = validate(req.params, locationIdSchema);
  const result = await warehouseService.deleteLocation(tenantId, locationId);

  success(
    res,
    result.data,
    null,
    result.message,
    result.status,
  );
});
