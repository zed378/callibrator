const tenantLifecycleService = require("../services/tenantLifecycle.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success, error } = require("../utils/response.util");
const {
  tenantIdSchema,
  suspendTenantSchema,
  validate,
} = require("../validators/tenantLifecycle.validator");

exports.suspendTenant = asyncHandler(async (req, res) => {
  // tenantId comes from the path (:tenantId); the body carries { reason }.
  // Merge so a correctly-formed call (id in path, reason in body) validates.
  const validated = validate({ ...req.params, ...req.body }, suspendTenantSchema);
  const result = await tenantLifecycleService.suspendTenant(
    validated.tenantId,
    validated.reason,
    req.user?.id,
  );

  success(res, result, null, "Tenant suspended");
});

exports.resumeTenant = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.resumeTenant(
    validated.tenantId,
    req.user?.id,
  );

  success(res, result, null, "Tenant resumed");
});

exports.enterGracePeriod = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.enterGracePeriod(validated.tenantId);

  success(res, result, null, "Tenant entered grace period");
});

exports.offboardTenant = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.offboardTenant(
    validated.tenantId,
    validated.force || false,
  );

  success(res, result, null, "Tenant offboarded");
});

exports.cancelOffboarding = asyncHandler(async (req, res) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await tenantLifecycleService.cancelOffboarding(validated.tenantId);

  success(res, result, null, "Offboarding cancelled");
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
