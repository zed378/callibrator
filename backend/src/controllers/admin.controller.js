const adminService = require("../services/admin.service");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");

exports.getAllTenants = asyncHandlerWithMapping(async (req, res) => {
  const { page, limit, search } = req.query;
  const result = await adminService.getAllTenants(page, limit, search);
  return {
    success: true,
    status: 200,
    message: "Tenants retrieved successfully",
    data: result,
  };
}, {});

exports.updateTenantStatus = asyncHandlerWithMapping(async (req, res) => {
  const { status } = req.body;
  const result = await adminService.updateTenantStatus(req.params.id, status);
  return {
    success: true,
    status: 200,
    message: `Tenant status updated to ${status}`,
    data: result,
  };
}, {
  "Tenant not found": 404,
  "Invalid status": 400,
});

exports.updateTenantFlags = asyncHandlerWithMapping(async (req, res) => {
  const { flags } = req.body;
  const result = await adminService.updateTenantFlags(req.params.id, flags);
  return {
    success: true,
    status: 200,
    message: "Tenant flags updated successfully",
    data: result,
  };
}, {
  "Tenant not found": 404,
});
