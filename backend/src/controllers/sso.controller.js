const crypto = require("crypto");
const ssoService = require("../services/sso.service");
const tenantService = require("../services/tenant.service");
const auditService = require("../services/audit.service");
const redis = require("../services/redis.service");
const { recordAuthFailure } = require("../services/rateLimiter.redis.service");
const { Tenants, sequelize } = require("../models");
const { generateAccessToken, generateOpaqueRefreshToken } = require("../utils/jwt.util");
const { createSession } = require("../services/session.service");
const { ssoLoginSchema, validate } = require("../validators/sso.validator");
const { AppError } = require("../utils/appError.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success, login } = require("../utils/response.util");
const { logger } = require("../middlewares/activityLog.middleware");

// ---------------------------------------------------------------------------
// A-60 — THE SSO HAND-OFF
//
// The callbacks used to redirect to `/sso-callback?token=…&refreshToken=…`,
// putting a live access token and refresh token into proxy logs, browser
// history and Referer headers. They now redirect with a ONE-TIME CODE: 32
// random bytes, valid for HANDOFF_TTL_SECONDS, redeemable exactly once, and
// worth nothing on its own. The frontend's server route (never the browser)
// posts it to POST /auth/sso/exchange, which creates the session and returns
// the tokens in the response body, the same shape /auth/login returns.
//
// What the code stands for is the IdP's verified answer — who, which tenant,
// and the browser's ip/user-agent at the callback — NOT tokens. The session and
// its tokens are created at the exchange, so an unredeemed code leaves no live
// session behind and no token ever sits in the store.
//
// The store key is the SHA-256 of the code, so a dump of Redis yields nothing
// redeemable.
//
// REDIS DOWN — the entry is kept in this process's memory instead, with the
// same TTL and the same single use. On one replica (the running deployment) SSO
// keeps working; across replicas an exchange that lands on another process
// finds nothing and is refused. It never fails open: no entry, no redemption.
// ---------------------------------------------------------------------------

const HANDOFF_TTL_SECONDS = 60;
const handoffKey = (code) =>
  `sso:handoff:${crypto.createHash("sha256").update(code).digest("hex")}`;

/** @type {Map<string, {entry: object, expiresAt: number}>} */
const memoryHandoffs = new Map();

const pruneMemoryHandoffs = (now) => {
  for (const [key, held] of memoryHandoffs) {
    if (held.expiresAt <= now) {
      memoryHandoffs.delete(key);
    }
  }
};

/**
 * Store the verified SSO identity under a fresh one-time code.
 *
 * @param {{userId: string, email: string, tenantId: string, ipAddress: string, userAgent: string, method: string}} entry
 * @returns {Promise<string>} the code — the only thing that goes in the redirect
 */
const issueHandoffCode = async (entry) => {
  const code = crypto.randomBytes(32).toString("base64url");
  const key = handoffKey(code);
  const stored = await redis.set(key, entry, HANDOFF_TTL_SECONDS);
  if (!stored) {
    const now = Date.now();
    pruneMemoryHandoffs(now);
    memoryHandoffs.set(key, { entry, expiresAt: now + HANDOFF_TTL_SECONDS * 1000 });
    logger.warn("SSO hand-off code held in process memory: Redis unavailable");
  }
  return code;
};

/**
 * Consume a code. Redis GETDEL is one command, so two racing redemptions
 * cannot both succeed; the memory fallback deletes before it returns.
 *
 * @param {string} code
 * @returns {Promise<object|null>} the stored entry, or null (unknown, expired or used)
 */
const redeemHandoffCode = async (code) => {
  const key = handoffKey(code);
  const fromRedis = await redis.getDel(key);
  if (fromRedis && typeof fromRedis === "object") {
    return fromRedis;
  }
  const held = memoryHandoffs.get(key);
  memoryHandoffs.delete(key);
  if (held && held.expiresAt > Date.now()) {
    return held.entry;
  }
  return null;
};

/**
 * Send the browser back to the frontend carrying only the one-time code.
 */
const handoffRedirect = async (req, res, tenant, user, method) => {
  const code = await issueHandoffCode({
    userId: user.id,
    email: user.email,
    tenantId: tenant.id,
    ipAddress: req.ip || "",
    userAgent: req.headers["user-agent"] || "",
    method,
  });
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const target = new URL("/sso-callback", frontendUrl);
  target.searchParams.set("code", code);
  res.redirect(target.toString());
};

/**
 * Create the session FIRST, then sign its id into the access token (`sid`) —
 * the same order loginUser uses. A-59: these callbacks used to sign
 * `{id, email}` and discard the session, so an SSO-issued token could not be
 * revoked by logout, an administrator's revoke, or a password change (A-48
 * checks the session only when the token names one).
 *
 * A-60: runs at the code exchange, not the callback. The session row and its
 * LOGIN audit row are written in one transaction (Sequelize CLS carries it into
 * createSession), so neither exists without the other.
 *
 * @param {{userId: string, email: string, tenantId: string, ipAddress: string, userAgent: string, method: string}} entry
 * @returns {Promise<{accessToken: string, session: object}>}
 */
const issueSsoTokens = async (entry) => {
  const refreshToken = generateOpaqueRefreshToken();

  const session = await sequelize.transaction(async (transaction) => {
    const created = await createSession({
      tenantId: entry.tenantId,
      userId: entry.userId,
      refreshToken,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });
    await auditService.logAction(
      {
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: "LOGIN",
        resourceType: "Session",
        resourceId: created.id,
        changes: { method: entry.method },
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
      },
      { transaction },
    );
    return created;
  });

  const accessToken = generateAccessToken({
    id: entry.userId,
    email: entry.email,
    sid: session.id,
  });

  return { accessToken, session };
};

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
  const { SAMLResponse, RelayState } = req.body || {};
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

  await handoffRedirect(req, res, tenant, user, "saml");
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
  const { code, state } = req.body || {};
  const tenantCode = req.params.tenantCode || (state ? state.split("_")[1] : null);

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

  await handoffRedirect(req, res, tenant, user, "oidc");
});

/**
 * Exchange an SSO hand-off code for a session (A-60).
 *
 * Called server-to-server by the frontend's /api/v1/auth/sso-session route.
 * The body has already passed validate(ssoExchangeSchema). An unknown, expired
 * or already-used code is one 401 — the three are indistinguishable on
 * purpose — and counts as a failure against the caller's IP.
 *
 * Answers exactly as /auth/login does (`login()`): the access token at the
 * top-level `token`, the session at `session`, so the frontend sets the same
 * cookies from the same fields.
 */
exports.ssoExchange = asyncHandler(async (req, res) => {
  const entry = await redeemHandoffCode(req.body.code);

  if (!entry) {
    try {
      await recordAuthFailure({ ...req.rateLimitContext, endpoint: "ssoExchange" });
    } catch (err) {
      logger.error(`SSO exchange failure recording error: ${err.message}`);
    }
    throw new AppError(401, "Invalid or expired SSO code");
  }

  const { accessToken, session } = await issueSsoTokens(entry);

  login(
    res,
    { id: entry.userId, email: entry.email, tenantId: entry.tenantId },
    accessToken,
    session,
  );
});

exports.HANDOFF_TTL_SECONDS = HANDOFF_TTL_SECONDS;
