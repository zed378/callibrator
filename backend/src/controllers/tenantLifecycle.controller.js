const tenantLifecycleService = require("../services/tenantLifecycle.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success, error } = require("../utils/response.util");
const { auditActor } = require("../utils/auditActor.util");
const {
  tenantIdSchema,
  suspendTenantSchema,
  validate,
} = require("../validators/tenantLifecycle.validator");
const { withoutRedactedSettings } = require("../constants/tenantSecretSettings");

/**
 * A-263 — a Tenant row as a lifecycle response carries it: plain, and without
 * any credential mirrored into its `settings` JSONB (the A-179 rule, which
 * GET /tenant-lifecycle/:tenantId/export already follows). The services return
 * the instance because their internal callers (the grace-period scheduler)
 * want one; the redaction belongs where the row leaves the server.
 *
 * @param {object|null} tenant - a Tenant instance or plain row
 * @returns {object|null}
 */
const tenantBody = (tenant) => {
  if (!tenant) {
    return tenant;
  }
  const plain = typeof tenant.toJSON === "function" ? tenant.toJSON() : { ...tenant };
  if (plain.settings !== undefined) {
    plain.settings = withoutRedactedSettings(plain.settings);
  }
  return plain;
};

exports.suspendTenant = asyncHandler(async (req, res) => {
  // tenantId comes from the path (:tenantId); the body carries { reason }.
  // Merge so a correctly-formed call (id in path, reason in body) validates.
  const validated = validate({ ...req.params, ...req.body }, suspendTenantSchema);
  const result = await tenantLifecycleService.suspendTenant(
    validated.tenantId,
    validated.reason,
    req.user?.id,
  );

  success(res, tenantBody(result), null, "Tenant suspended");
});

exports.resumeTenant = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.resumeTenant(
    validated.tenantId,
    req.user?.id,
  );

  success(res, tenantBody(result), null, "Tenant resumed");
});

exports.enterGracePeriod = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.enterGracePeriod(validated.tenantId);

  success(res, tenantBody(result), null, "Tenant entered grace period");
});

exports.offboardTenant = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  // The operator is the audit row's actor (W-04); without one it would be
  // recorded as the scheduler. Not auditActor's tenantId: the row belongs to
  // the tenant being offboarded, not to the operator's home tenant.
  const { userId, ipAddress, userAgent } = auditActor(req);
  const result = await tenantLifecycleService.offboardTenant(
    validated.tenantId,
    validated.force || false,
    { userId, ipAddress, userAgent },
  );

  // offboardTenant answers { tenant } (W-17), or the row itself when the
  // tenant was already offboarded and force was not given.
  const offboarded = result && result.tenant ? { ...result, tenant: tenantBody(result.tenant) } : tenantBody(result);
  success(res, offboarded, null, "Tenant offboarded");
});

exports.cancelOffboarding = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.cancelOffboarding(validated.tenantId);

  success(res, tenantBody(result), null, "Offboarding cancelled");
});

exports.getTenantLifecycleStatus = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.getTenantLifecycleStatus(validated.tenantId);

  success(res, result, null, "Fetch lifecycle status successful");
});

exports.exportTenantData = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.exportTenantData(validated.tenantId);

  success(res, result, null, "Tenant data exported");
});
