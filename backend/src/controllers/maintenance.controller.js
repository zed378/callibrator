const maintenanceService = require("../services/maintenance.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
// A-282 (ADR-100): an API key (maintenance scopes) is audited as system:api-key.
const { auditPrincipal } = require("../utils/auditPrincipal.util");

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

  const result = await maintenanceService.createWorkOrder(tenantId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

exports.updateWorkOrder = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { orderId } = req.params;
  const data = req.body;

  const result = await maintenanceService.updateWorkOrder(tenantId, orderId, data, auditPrincipal(req));
  success(res, result.data, null, result.message, result.status);
});

exports.deleteWorkOrder = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { orderId } = req.params;

  const result = await maintenanceService.deleteWorkOrder(tenantId, orderId, auditPrincipal(req));
  success(res, null, null, result.message, result.status);
});
