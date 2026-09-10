const ssoService = require("../services/sso.service");
const tenantService = require("../services/tenant.service");
const { Tenants } = require("../models");
const { generateAccessToken, generateOpaqueRefreshToken } = require("../utils/jwt.util");
const { createSession } = require("../services/session.service");
const { ssoLoginSchema, validate } = require("../validators/sso.validator");
const { AppError } = require("../utils/appError.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

/**
 * Handle SSO Login Redirect generation
 */
exports.ssoLogin = asyncHandler(async (req, res) => {
  const { tenantCode } = validate(req.body, ssoLoginSchema);

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw new AppError(400, "SSO is not enabled for this tenant");
  }

  if (!ssoSettings.sso_idp_entry_point) {
    throw new AppError(400, "SSO entry point is not configured for this tenant");
  }

  const redirectUrl = ssoService.generateAuthnRequest(tenant.code, ssoSettings);

  success(res, { redirectUrl }, null, "SAML redirect URL generated", 200);
});

/**
 * Handle SAML ACS Callback
 */
exports.ssoCallback = asyncHandler(async (req, res) => {
  const { SAMLResponse, RelayState } = req.body;
  const tenantCode = req.params.tenantCode || RelayState;

  if (!tenantCode) {
    throw new AppError(400, "Tenant identifier (RelayState or URL parameter) is required");
  }

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw new AppError(400, "SSO is not enabled for this tenant");
  }

  const userData = await ssoService.parseAndVerifyResponse(SAMLResponse, ssoSettings);
  const user = await ssoService.provisionUser(tenant.id, userData);

  // Generate tokens
  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
  });
  const refreshToken = generateOpaqueRefreshToken();

  // Create session
  await createSession({
    tenantId: tenant.id,
    userId: user.id,
    refreshToken,
    ipAddress: req.ip || "",
    userAgent: req.headers["user-agent"] || "",
    expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  res.redirect(`${frontendUrl}/sso-callback?token=${accessToken}&refreshToken=${refreshToken}`);
});

/**
 * Handle SAML SP Metadata endpoint
 */
exports.ssoMetadata = asyncHandler(async (req, res) => {
  const tenantCode = req.params.tenantCode || req.query.tenantCode;

  if (!tenantCode) {
    throw new AppError(400, "Tenant code is required");
  }

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id);
  const ssoSettings = settingsResult.data?.settings || {};

  const hostUrl = process.env.HOST_URL || "http://localhost:5000";
  const spEntityId = ssoSettings.sso_sp_entity_id || `${hostUrl}/api/v1/auth/sso/metadata/${tenant.code}`;
  const acsUrl = ssoSettings.sso_sp_callback_url || `${hostUrl}/api/v1/auth/sso/callback/${tenant.code}`;

  const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor entityID="${spEntityId}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="1" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

  res.set("Content-Type", "application/xml");
  res.status(200).send(metadataXml);
});

/**
 * Handle OIDC Login Redirect generation
 */
exports.oidcLogin = asyncHandler(async (req, res) => {
  const { tenantCode } = validate(req.body, ssoLoginSchema);

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw new AppError(400, "SSO is not enabled for this tenant");
  }

  if (!ssoSettings.oidc_client_id) {
    throw new AppError(400, "OIDC is not configured for this tenant");
  }

  const redirectUrl = ssoService.generateOidcAuthRequest(tenant.code, ssoSettings);

  success(res, { redirectUrl }, null, "OIDC redirect URL generated", 200);
});

/**
 * Handle OIDC Callback
 */
exports.oidcCallback = asyncHandler(async (req, res) => {
  const { code, state } = req.body;
  const tenantCode = req.params.tenantCode || (state ? state.split('_')[1] : null);

  if (!tenantCode || !code) {
    throw new AppError(400, "Tenant identifier and authorization code are required");
  }

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw new AppError(400, "SSO is not enabled for this tenant");
  }

  const hostUrl = process.env.HOST_URL || "http://localhost:5000";
  const redirectUri = ssoSettings.oidc_redirect_uri || `${hostUrl}/api/v1/auth/sso/oidc/callback/${tenant.code}`;

  const userData = await ssoService.verifyOidcCallback(code, ssoSettings, redirectUri);
  const user = await ssoService.provisionUser(tenant.id, userData);

  // Generate tokens
  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
  });
  const refreshToken = generateOpaqueRefreshToken();

  // Create session
  await createSession({
    tenantId: tenant.id,
    userId: user.id,
    refreshToken,
    ipAddress: req.ip || "",
    userAgent: req.headers["user-agent"] || "",
    expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  // The frontend handles saving the tokens
  res.redirect(`${frontendUrl}/sso-callback?token=${accessToken}&refreshToken=${refreshToken}`);
});
