const maintenanceService = require("../services/maintenance.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.fetchWorkOrders = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { find, page, limit, status, type, priority, deviceId } = req.query;

  const result = await maintenanceService.fetchWorkOrders({
    tenantId,
    find,
    page,
    limit,
    status,
    type,
    priority,
    deviceId,
  });

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

exports.getWorkOrderById = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { orderId } = req.params;

  const result = await maintenanceService.getWorkOrderById(tenantId, orderId);
  success(res, result.data, null, result.message, result.status);
});

exports.createWorkOrder = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const data = req.body;

  const result = await maintenanceService.createWorkOrder(tenantId, data);
  success(res, result.data, null, result.message, result.status);
});

exports.updateWorkOrder = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { orderId } = req.params;
  const data = req.body;

  const result = await maintenanceService.updateWorkOrder(tenantId, orderId, data);
  success(res, result.data, null, result.message, result.status);
});

exports.deleteWorkOrder = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { orderId } = req.params;

  const result = await maintenanceService.deleteWorkOrder(tenantId, orderId);
  success(res, null, null, result.message, result.status);
});
