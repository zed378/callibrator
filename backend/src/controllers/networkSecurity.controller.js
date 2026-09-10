const networkSecurityService = require("../services/networkSecurity.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { auth, superAdminOnly } = require("../middlewares/auth.middleware");
const {
  ipAllowlistSchema,
  geofenceSchema,
  evaluateLoginSchema,
  validate,
} = require("../validators/networkSecurity.validator");

exports.getIpAllowlist = asyncHandler(async (req, res) => {
  const result = await networkSecurityService.getTenantIpAllowlist(req.user?.tenantId);
  success(res, { allowlist: result }, null, "Fetch IP allowlist");
});

exports.setIpAllowlist = asyncHandler(async (req, res) => {
  const validated = validate(req.body, ipAllowlistSchema);
  const result = await networkSecurityService.setTenantIpAllowlist(
    req.user?.tenantId,
    validated.cidrs,
  );
  success(res, result, null, "IP allowlist updated");
});

exports.getGeofence = asyncHandler(async (req, res) => {
  const result = await networkSecurityService.getTenantGeofence(req.user?.tenantId);
  success(res, { geofence: result }, null, "Fetch geofence");
});

exports.setGeofence = asyncHandler(async (req, res) => {
  const validated = validate(req.body, geofenceSchema);
  const result = await networkSecurityService.setTenantGeofence(
    req.user?.tenantId,
    validated,
  );
  success(res, result, null, "Geofence updated");
});

exports.evaluateLogin = asyncHandler(async (req, res) => {
  const validated = validate(req.body, evaluateLoginSchema);
  const result = await networkSecurityService.evaluateLoginSecurity(
    req.user?.tenantId,
    validated.ip,
    validated.latitude,
    validated.longitude,
  );
  success(res, result, null, "Login security evaluated");
});
