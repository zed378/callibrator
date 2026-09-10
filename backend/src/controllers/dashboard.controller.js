/**
 * Dashboard Controller
 *
 * Serves aggregated dashboard metrics.
 * SUPERADMIN gets global metrics (with per-tenant breakdown);
 * every other role gets metrics scoped to their own tenant.
 */

const dashboardService = require("../services/dashboard.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { ROLE_NAMES } = require("../constants/roleConstants");

exports.getDashboardMetrics = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user?.role?.name === ROLE_NAMES.SUPER_ADMIN;

  // SUPERADMIN may optionally inspect a single tenant via ?tenantId=...;
  // otherwise they get the global view. Non-superadmins are ALWAYS pinned
  // to their own tenant — the query param is ignored for them.
  const tenantId = isSuperAdmin
    ? req.query.tenantId || null
    : req.user.tenantId;

  const result = await dashboardService.getDashboardMetrics(tenantId);

  success(res, result.data, null, result.message, result.status);
});
