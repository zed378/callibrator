const calibrationScheduler = require("../services/calibrationScheduler.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { ROLE_NAMES } = require("../constants/roleConstants");

// Determines which tenant(s) the scan targets. Super admins may target all
// tenants (allTenants=true) or a specific tenant (body.tenantId); everyone else
// is scoped to their own tenant.
const resolveScanScope = (req) => {
  const isSuperAdmin = req.user?.role?.name === ROLE_NAMES.SUPER_ADMIN;
  const wantsAll =
    req.query.allTenants === "true" || req.body?.allTenants === true;

  if (isSuperAdmin && wantsAll) {
    return { tenantId: null };
  }
  if (isSuperAdmin && req.body?.tenantId) {
    return { tenantId: req.body.tenantId };
  }
  return { tenantId: req.user.tenantId };
};

const parseLeadDays = (raw) => {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

// POST /api/v1/calibration-scheduler/run
exports.runScan = asyncHandler(async (req, res) => {
  const { tenantId } = resolveScanScope(req);
  const leadDays = parseLeadDays(req.body?.leadDays);
  const summary = await calibrationScheduler.runCalibrationScan({
    tenantId,
    leadDays,
  });
  success(res, summary, null, "Calibration scan completed", 200);
});

// GET /api/v1/calibration-scheduler/due
exports.listDue = asyncHandler(async (req, res) => {
  const { tenantId } = resolveScanScope(req);
  const leadDays = parseLeadDays(req.query.leadDays);
  const devices = await calibrationScheduler.getDueDevices({
    tenantId,
    leadDays,
  });
  success(res, devices, null, "Due calibration devices retrieved", 200);
});
