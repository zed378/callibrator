const calibrationScheduler = require("../services/calibrationScheduler.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
// N-01: the one super-admin predicate (both spellings).
const { isSuperAdmin: isSuperAdminPrincipal } = require("../utils/role.util");
// A-282 (ADR-100): a manual run by an API key is audited as system:api-key.
const { auditPrincipal } = require("../utils/auditPrincipal.util");

// Determines which tenant(s) the scan targets. Super admins may target all
// tenants (allTenants=true) or a specific tenant (body.tenantId); everyone else
// is scoped to their own tenant.
const resolveScanScope = (req) => {
  const isSuperAdmin = isSuperAdminPrincipal(req.user);
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
    // W-30: a manual run's work orders are the user's, audited as theirs.
    actor: auditPrincipal(req),
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
