const quotaService = require("../services/quota.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { AppError } = require("../utils/appError.util");

// GET /api/v1/quota — the current tenant's plan, seat/storage usage, and features.
exports.getUsage = asyncHandler(async (req, res) => {
  const tenantId = req.user?.tenantId;
  const summary = await quotaService.getUsageSummary(tenantId);
  if (!summary) {
    throw new AppError(404, "Tenant not found");
  }
  success(res, summary, null, "Quota usage retrieved", 200);
});
