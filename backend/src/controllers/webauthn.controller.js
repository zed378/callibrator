const webauthnService = require("../services/webauthn.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { auth } = require("../middlewares/auth.middleware");

exports.getStatus = asyncHandler(async (req, res) => {
  const result = await webauthnService.getStatus(req.user?.tenantId, req.user?.id);
  success(res, result, null, "WebAuthn status");
});

exports.getRegistrationOptions = asyncHandler(async (req, res) => {
  const options = await webauthnService.getRegistrationOptions(req.user);
  success(res, options, null, "WebAuthn registration options");
});

exports.verifyRegistration = asyncHandler(async (req, res) => {
  const result = await webauthnService.verifyRegistration(
    req.user?.tenantId,
    req.user?.id,
    req.body,
  );
  success(res, result, null, "WebAuthn registration verified");
});

exports.getLoginOptions = asyncHandler(async (req, res) => {
  const options = await webauthnService.getLoginOptions(req.user?.id);
  success(res, options, null, "WebAuthn login options");
});

exports.verifyLogin = asyncHandler(async (req, res) => {
  const result = await webauthnService.verifyLogin(
    req.user?.tenantId,
    req.user?.id,
    req.body,
  );
  success(res, result, null, "WebAuthn login verified");
});

exports.disable = asyncHandler(async (req, res) => {
  const result = await webauthnService.disable(req.user?.tenantId, req.user?.id);
  success(res, result, null, "WebAuthn disabled");
});
