const vendorService = require("../services/vendor.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

exports.fetchVendors = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { find, page, limit, status, type } = req.query;

  const result = await vendorService.fetchVendors({
    tenantId,
    find,
    page,
    limit,
    status,
    type,
  });

  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

exports.getVendorById = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { vendorId } = req.params;

  const result = await vendorService.getVendorById(tenantId, vendorId);
  success(res, result.data, null, result.message, result.status);
});

exports.createVendor = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const data = req.body;

  const result = await vendorService.createVendor(tenantId, data);
  success(res, result.data, null, result.message, result.status);
});

exports.updateVendor = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { vendorId } = req.params;
  const data = req.body;

  const result = await vendorService.updateVendor(tenantId, vendorId, data);
  success(res, result.data, null, result.message, result.status);
});

exports.deleteVendor = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { vendorId } = req.params;

  const result = await vendorService.deleteVendor(tenantId, vendorId);
  success(res, null, null, result.message, result.status);
});

exports.qualifyVendor = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { vendorId } = req.params;
  const { approvalStatus, scorecard, lastAuditDate, nextAuditDate } = req.body;

  const result = await vendorService.qualifyVendor({
    tenantId,
    id: vendorId,
    approvalStatus,
    scorecard,
    lastAuditDate,
    nextAuditDate,
  });

  success(res, result, null, "Vendor qualification updated", 200);
});

