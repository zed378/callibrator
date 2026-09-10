const oidcProviderService = require("../services/oidcProvider.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const { oidcClientSchema, validate } = require("../validators/oidc.validator");

// --------------------------------------------------------------------------
// Public OIDC metadata — returned as RAW JSON (the OIDC spec shape), NOT the
// app's {success,data} envelope, so conformant relying-party libraries can
// parse them.
// --------------------------------------------------------------------------

exports.discover = asyncHandler(async (req, res) => {
  res.json(oidcProviderService.discover());
});

exports.jwks = asyncHandler(async (req, res) => {
  res.json(oidcProviderService.jwks());
});

// --------------------------------------------------------------------------
// Authorization endpoint (browser) — validate + redirect to the consent screen.
// --------------------------------------------------------------------------

exports.authorize = asyncHandler(async (req, res) => {
  const { consentUrl } = await oidcProviderService.beginAuthorization(req.query);
  res.redirect(consentUrl);
});

// The consent screen (authenticated) reads the staged request to render it.
exports.getAuthRequest = asyncHandler(async (req, res) => {
  const data = await oidcProviderService.getAuthRequest(req.params.requestId);
  if (!data) {
    return success(res, null, null, "Authorization request not found", 404);
  }
  success(res, data, null, "Authorization request");
});

// The authenticated user's Approve/Deny decision → returns the redirect target.
exports.decision = asyncHandler(async (req, res) => {
  const { request, approve } = req.body;
  const result = await oidcProviderService.decideAuthorization(
    request,
    req.user,
    approve === true || approve === "true",
  );
  success(res, result, null, "Authorization decision");
});

// --------------------------------------------------------------------------
// Token + userinfo — RAW JSON, with OAuth 2.0-style error bodies.
// --------------------------------------------------------------------------

const oauthError = (res, err) => {
  const status = err.status || 400;
  // Service errors are formatted "error_code: description".
  const [code, ...rest] = String(err.message || "invalid_request").split(":");
  res.status(status).json({
    error: rest.length ? code.trim() : "invalid_request",
    error_description: rest.join(":").trim() || err.message,
  });
};

exports.token = async (req, res) => {
  try {
    const {
      grant_type,
      code,
      client_id,
      client_secret,
      redirect_uri,
      code_verifier,
      refresh_token,
    } = req.body || {};

    let tokens;
    if (grant_type === "authorization_code") {
      tokens = await oidcProviderService.exchangeAuthorizationCode({
        code,
        clientId: client_id,
        clientSecret: client_secret,
        redirectUri: redirect_uri,
        codeVerifier: code_verifier,
      });
    } else if (grant_type === "refresh_token") {
      tokens = await oidcProviderService.refreshAccessToken({
        refreshToken: refresh_token,
        clientId: client_id,
        clientSecret: client_secret,
      });
    } else {
      return res
        .status(400)
        .json({ error: "unsupported_grant_type" });
    }
    res.json(tokens);
  } catch (err) {
    oauthError(res, err);
  }
};

exports.userinfo = async (req, res) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "invalid_token" });
    }
    const claims = await oidcProviderService.getUserInfo(token);
    res.json(claims);
  } catch (err) {
    oauthError(res, err);
  }
};

// --------------------------------------------------------------------------
// Client management (app-internal API) — keeps the {success,data} envelope.
// --------------------------------------------------------------------------

exports.registerClient = asyncHandler(async (req, res) => {
  const validated = validate(req.body, oidcClientSchema);
  const result = await oidcProviderService.registerClient(req.user?.tenantId, validated);
  success(res, result, null, "OIDC client registered");
});

exports.getClients = asyncHandler(async (req, res) => {
  const result = await oidcProviderService.getClients(req.user?.tenantId);
  success(res, result, null, "Fetch OIDC clients");
});

exports.rotateSecret = asyncHandler(async (req, res) => {
  const { clientId } = req.params;
  const result = await oidcProviderService.rotateSecret(req.user?.tenantId, clientId);
  success(res, result, null, "Client secret rotated");
});

exports.deleteClient = asyncHandler(async (req, res) => {
  const { clientId } = req.params;
  const result = await oidcProviderService.deleteClient(req.user?.tenantId, clientId);
  success(res, result, null, "OIDC client deleted");
});
