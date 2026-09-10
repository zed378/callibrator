const featureFlagService = require("../services/featureFlag.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success, error } = require("../utils/response.util");
const {
  flagKeySchema,
  flagValueSchema,
  tenantFlagQuerySchema,
  validate,
} = require("../validators/featureFlag.validator");

exports.getTenantFlags = asyncHandler(async (req, res) => {
  const validated = validate(req.query, tenantFlagQuerySchema);
  const result = await featureFlagService.getTenantFlags(validated.tenantId);

  success(res, result, null, "Fetch feature flags successful");
});

exports.isFlagEnabled = asyncHandler(async (req, res) => {
  const validated = validate(
    { ...req.params, ...req.query },
    flagKeySchema,
  );
  const result = await featureFlagService.isEnabled(
    validated.tenantId,
    validated.flagKey,
  );

  success(res, { flagKey: validated.flagKey, enabled: result }, null, "Flag status fetched");
});

exports.setTenantFlag = asyncHandler(async (req, res) => {
  // tenantId + flagKey are path params (:tenantId/:flagKey); merge with the
  // body (which carries `enabled`) so the documented { enabled } payload works.
  const validated = validate({ ...req.params, ...req.body }, flagValueSchema);
  const result = await featureFlagService.setTenantFlag(
    validated.tenantId,
    validated.flagKey,
    validated.enabled,
    req.user?.id,
  );

  success(res, result, null, "Feature flag updated");
});

exports.resetTenantFlag = asyncHandler(async (req, res) => {
  const validated = validate(req.params, flagKeySchema);
  const result = await featureFlagService.resetTenantFlag(
    validated.tenantId,
    validated.flagKey,
  );

  success(res, result, null, "Feature flag reset to default");
});

exports.initializeTenantFlags = asyncHandler(async (req, res) => {
  // Only tenantId is in the path here — validating against flagKeySchema (which
  // also requires flagKey) rejected every call with 400.
  const validated = validate(req.params, tenantFlagQuerySchema);
  const result = await featureFlagService.initializeTenantFlags(validated.tenantId);

  success(res, result, null, "Feature flags initialized");
});

exports.getAllFlagDefinitions = asyncHandler(async (req, res) => {
  success(res, featureFlagService.DEFAULT_FLAGS, null, "Fetch flag definitions successful");
});
