const crypto = require("crypto");
const ssoService = require("../services/sso.service");
const oidcJwks = require("../services/oidcJwks");
const tenantService = require("../services/tenant.service");
const auditService = require("../services/audit.service");
const redis = require("../services/redis.service");
const { noteAuthFailure } = require("../services/rateLimiter.redis.service");
const { Tenants, Users, sequelize } = require("../models");
const { tenantInclude, tenantRefusal } = require("../services/auth.service");
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

/**
 * A-150: getTenantSettings masks secret values by default (it also answers
 * `POST /tenants/settings`). The SSO flows need the real IdP certificate and
 * OIDC client secret to talk to the identity provider, so they ask for them;
 * nothing here returns them to the caller.
 */
const SSO_SETTINGS = Object.freeze({ includeSecrets: true });

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

// ---------------------------------------------------------------------------
// A-68 — OIDC SIGN-IN STATE: `state`, `nonce` and PKCE
//
// The authorize request used to carry a `state` that was stored nowhere and a
// callback that only split it to find the tenant, with no nonce and no PKCE —
// so the callback accepted ANY authorization code with ANY state: login CSRF
// (a victim signed into the attacker's account) and code injection.
//
// Now each OIDC sign-in begins by minting four random values:
//   state         — goes to the IdP and comes back; the store key (hashed)
//   nonce         — goes to the IdP; must come back inside the ID token
//   code_verifier — stays HERE; the IdP gets only its S256 challenge, and the
//                   token endpoint demands the verifier (RFC 7636)
//   binding       — goes to the BROWSER only, in an httpOnly cookie
// The store entry holds the tenant, redirect_uri, nonce, verifier and the
// binding's hash, for OIDC_FLOW_TTL_SECONDS. The callback consumes it with one
// GETDEL (single use across replicas), then requires the browser's cookie to
// hash to the stored binding. A state that is missing, unknown, expired, used,
// or presented by a browser that did not start the sign-in is refused before
// the code is ever sent to the IdP.
//
// REDIS DOWN — held in process memory with the same TTL and single use, as the
// hand-off codes are. It never fails open.
//
// The cookie is SameSite=Lax: the IdP returns with a top-level GET
// (response_mode=query), which Lax cookies accompany. A form_post return (a
// cross-site POST) would NOT carry it, and is therefore refused.
// ---------------------------------------------------------------------------

const OIDC_FLOW_TTL_SECONDS = 600;
const OIDC_BINDING_COOKIE = "sso_oidc_binding";
/** The browser sends it only to the OIDC routes — through the Next proxy too. */
const OIDC_BINDING_COOKIE_PATH = "/api/v1/auth/sso/oidc";

const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const oidcFlowKey = (state) => `sso:oidc:state:${sha256Hex(state)}`;
const randomToken = () => crypto.randomBytes(32).toString("base64url");

/** @type {Map<string, {entry: object, expiresAt: number}>} */
const memoryOidcFlows = new Map();

const bindingCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: OIDC_BINDING_COOKIE_PATH,
});

/**
 * Start an OIDC sign-in: mint state, nonce, PKCE verifier and browser binding,
 * and store what the callback will need.
 *
 * @param {string} tenantCode
 * @param {string} redirectUri - the exact redirect_uri sent to the IdP
 * @returns {Promise<{state: string, nonce: string, codeChallenge: string, binding: string}>}
 */
const beginOidcFlow = async (tenantCode, redirectUri) => {
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken();
  const binding = randomToken();
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const entry = { tenantCode, redirectUri, nonce, codeVerifier, bindingHash: sha256Hex(binding) };
  const key = oidcFlowKey(state);
  const stored = await redis.set(key, entry, OIDC_FLOW_TTL_SECONDS);
  if (!stored) {
    const now = Date.now();
    for (const [heldKey, held] of memoryOidcFlows) {
      if (held.expiresAt <= now) {
        memoryOidcFlows.delete(heldKey);
      }
    }
    memoryOidcFlows.set(key, { entry, expiresAt: now + OIDC_FLOW_TTL_SECONDS * 1000 });
    logger.warn("OIDC sign-in state held in process memory: Redis unavailable");
  }
  return { state, nonce, codeChallenge, binding };
};

/**
 * Consume a state — once — and check it belongs to this browser.
 *
 * @param {string} state - from the IdP's redirect
 * @param {string|null} binding - the browser's binding cookie
 * @returns {Promise<object|null>} the stored entry, or null (refuse)
 */
const consumeOidcFlow = async (state, binding) => {
  const key = oidcFlowKey(String(state));
  let entry = await redis.getDel(key);
  if (!entry || typeof entry !== "object") {
    const held = memoryOidcFlows.get(key);
    memoryOidcFlows.delete(key);
    entry = held && held.expiresAt > Date.now() ? held.entry : null;
  }
  if (!entry || !binding) {
    return null;
  }
  const expected = Buffer.from(entry.bindingHash, "hex");
  const presented = Buffer.from(sha256Hex(binding), "hex");
  return crypto.timingSafeEqual(expected, presented) ? entry : null;
};

/**
 * One cookie's value from a Cookie header. The backend has no cookie parser;
 * this is the only cookie it reads.
 */
const readCookie = (header, name) => {
  for (const part of String(header || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      return part.slice(at + 1).trim();
    }
  }
  return null;
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
      // A-160: the session is federated; its MFA is the IdP's (0052).
      authMethod: entry.method,
    });
    // A-188: an SSO sign-in is a sign-in — "last login" used to stay at the
    // last PASSWORD sign-in, so an SSO-only account looked dormant. Written in
    // the session's transaction; pre-auth there is no tenant context, and the
    // row is named by id and its own tenant.
    await Users.update(
      { lastLoginAt: new Date() },
      { where: { id: entry.userId, tenantId: entry.tenantId }, transaction, skipTenantScope: true },
    );
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
    // A-160: read by the tenant MFA policy (auth.middleware).
    amr: entry.method,
  });

  return { accessToken, session };
};

/**
 * Handle SSO Login Redirect generation
 */
exports.ssoLogin = asyncHandler(async (req, res) => {
  // A-68 (found in passing): validate() returns Joi's `{ value, error }`, so
  // destructuring `tenantCode` from it always gave undefined — and Sequelize
  // throws on `where: { code: undefined }`: every SSO start was a 500.
  const { value, error: invalid } = validate(req.body, ssoLoginSchema);
  if (invalid) {
    throw new AppError(400, "Tenant code is required");
  }
  const { tenantCode } = value;

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
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

// ---------------------------------------------------------------------------
// A-188 — A REFUSED CALLBACK SENDS THE BROWSER BACK TO THE LOGIN PAGE
//
// The SAML ACS and the OIDC callback are reached by the BROWSER, returning
// from the identity provider. A refusal used to answer with the JSON error
// envelope, which the browser rendered as a raw page. It now redirects to
// `${FRONTEND_URL}/login?error=<code>`, where the login page shows a message
// for the code. Only a fixed code goes in the URL — never the reason, which
// may name the IdP's answer; the reason is logged.
// ---------------------------------------------------------------------------

const SSO_ERROR_CODES = Object.freeze({
  STATE: "sso_state",
  UNAVAILABLE: "sso_unavailable",
  ACCOUNT_REFUSED: "sso_account_refused",
  FAILED: "sso_failed",
  ERROR: "sso_error",
});

/**
 * @param {string} message
 * @param {number} status
 * @param {string} ssoCode - one of SSO_ERROR_CODES
 * @returns {AppError}
 */
const callbackRefusal = (message, status, ssoCode) =>
  Object.assign(new AppError(status, message), { ssoCode });

/**
 * The code a refused callback is answered with.
 *
 * @param {{ssoCode?: string, status?: number, statusCode?: number}} err
 * @returns {string}
 */
const refusalCode = (err) => {
  if (err.ssoCode) {
    return err.ssoCode;
  }
  const status = err.status || err.statusCode || 500;
  if (status === 403) {
    return SSO_ERROR_CODES.ACCOUNT_REFUSED;
  }
  return status >= 500 ? SSO_ERROR_CODES.ERROR : SSO_ERROR_CODES.FAILED;
};

/**
 * Run a browser-facing callback; on refusal, log why and send the browser to
 * the login page with a code.
 *
 * @param {string} protocol - "saml" | "oidc", for the log
 * @param {(req: object, res: object) => Promise<void>} handler
 * @returns {(req: object, res: object) => Promise<void>}
 */
const refuseToLoginPage = (protocol, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    const code = refusalCode(err);
    logger.warn("SSO callback refused", {
      protocol,
      code,
      status: err.status || err.statusCode || 500,
      reason: err.message,
    });
    const target = new URL("/login", process.env.FRONTEND_URL || "http://localhost:3000");
    target.searchParams.set("error", code);
    res.redirect(target.toString());
  }
};

exports.SSO_ERROR_CODES = SSO_ERROR_CODES;

/**
 * Handle SAML ACS Callback
 */
exports.ssoCallback = asyncHandler(refuseToLoginPage("saml", async (req, res) => {
  const { SAMLResponse, RelayState } = req.body || {};
  const tenantCode = req.params.tenantCode || RelayState;

  if (!tenantCode) {
    throw callbackRefusal(
      "Tenant identifier (RelayState or URL parameter) is required",
      400,
      SSO_ERROR_CODES.UNAVAILABLE,
    );
  }

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw callbackRefusal("Tenant not found", 404, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw callbackRefusal("SSO is not enabled for this tenant", 400, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const userData = await ssoService.parseAndVerifyResponse(SAMLResponse, ssoSettings);
  const user = await ssoService.provisionUser(tenant.id, userData);

  await handoffRedirect(req, res, tenant, user, "saml");
}));

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
  // A-68 (found in passing): validate() returns Joi's `{ value, error }`, so
  // destructuring `tenantCode` from it always gave undefined — and Sequelize
  // throws on `where: { code: undefined }`: every SSO start was a 500.
  const { value, error: invalid } = validate(req.body, ssoLoginSchema);
  if (invalid) {
    throw new AppError(400, "Tenant code is required");
  }
  const { tenantCode } = value;

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw new AppError(400, "SSO is not enabled for this tenant");
  }

  if (!ssoSettings.oidc_client_id) {
    throw new AppError(400, "OIDC is not configured for this tenant");
  }

  // A-68: redirect_uri is fixed HERE and stored with the state, so the token
  // exchange sends exactly the value the authorize request did.
  const hostUrl = process.env.HOST_URL || "http://localhost:5000";
  const redirectUri = ssoSettings.oidc_redirect_uri || `${hostUrl}/api/v1/auth/sso/oidc/callback/${tenant.code}`;
  // A-188: the IdP's own authorization endpoint, from its discovery document
  // (a missing or multi-tenant authority is refused here, before any state).
  const provider = await oidcJwks.discover(ssoSettings);
  const flow = await beginOidcFlow(tenant.code, redirectUri);

  const redirectUrl = ssoService.generateOidcAuthRequest(tenant.code, ssoSettings, {
    state: flow.state,
    nonce: flow.nonce,
    codeChallenge: flow.codeChallenge,
    redirectUri,
    authorizationEndpoint: provider.authorizationEndpoint,
  });

  res.cookie(OIDC_BINDING_COOKIE, flow.binding, {
    ...bindingCookieOptions(),
    maxAge: OIDC_FLOW_TTL_SECONDS * 1000,
  });
  success(res, { redirectUrl }, null, "OIDC redirect URL generated", 200);
});

/**
 * Handle OIDC Callback
 */
exports.oidcCallback = asyncHandler(refuseToLoginPage("oidc", async (req, res) => {
  // A-68/A-69: the IdP returns with a GET (?code&state, response_mode=query);
  // a POSTed form body is still read.
  const { code, state } = { ...req.query, ...req.body };

  if (!code || !state) {
    throw callbackRefusal("Authorization code and state are required", 400, SSO_ERROR_CODES.STATE);
  }

  // A-68: consume the state once, bound to this browser; the binding cookie is
  // spent with it whatever the outcome.
  const flow = await consumeOidcFlow(state, readCookie(req.headers.cookie, OIDC_BINDING_COOKIE));
  res.clearCookie(OIDC_BINDING_COOKIE, bindingCookieOptions());
  if (!flow || (req.params.tenantCode && req.params.tenantCode !== flow.tenantCode)) {
    throw callbackRefusal("Invalid or expired SSO sign-in state", 401, SSO_ERROR_CODES.STATE);
  }
  const { tenantCode } = flow;

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw callbackRefusal("Tenant not found", 404, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
  const ssoSettings = settingsResult.data?.settings || {};

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw callbackRefusal("SSO is not enabled for this tenant", 400, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const userData = await ssoService.verifyOidcCallback(code, ssoSettings, flow.redirectUri, {
    nonce: flow.nonce,
    codeVerifier: flow.codeVerifier,
  });
  const user = await ssoService.provisionUser(tenant.id, userData);

  await handoffRedirect(req, res, tenant, user, "oidc");
}));

/**
 * Exchange an SSO hand-off code for a session (A-60).
 *
 * Called server-to-server by the frontend's /api/v1/auth/sso-session route.
 * The body has already passed validate(ssoExchangeSchema). An unknown, expired
 * or already-used code is one 401 — the three are indistinguishable on
 * purpose — and counts as a failure against the caller's IP when
 * AUTH_RATE_LIMIT_BY_IP is "true" (A-100).
 *
 * Answers exactly as /auth/login does (`login()`): the access token at the
 * top-level `token`, the session at `session`, so the frontend sets the same
 * cookies from the same fields.
 */
exports.ssoExchange = asyncHandler(async (req, res) => {
  const entry = await redeemHandoffCode(req.body.code);

  if (!entry) {
    // A-100: counted through noteAuthFailure, like every other auth endpoint
    // (A-67, A-81), so the per-IP count obeys AUTH_RATE_LIMIT_BY_IP. It used
    // to call recordAuthFailure directly and count by IP unconditionally —
    // and this endpoint is called server-to-server by the frontend, so until
    // a deployment's req.ip is known to be the client (A-16), that address
    // can be one shared by every browser: 30 bad codes from anyone would have
    // locked SSO sign-in for everyone for five minutes. The code itself is
    // 256 bits, so the count is defence in depth, not the barrier.
    // noteAuthFailure never throws: a limiter fault must not turn this 401
    // into a 500.
    await noteAuthFailure(req, "ssoExchange");
    throw new AppError(401, "Invalid or expired SSO code");
  }

  // A-83: the user and the tenant are checked AGAIN at redemption. The code
  // was issued for the IdP's answer at the callback; an account suspended
  // (SCIM deprovisioning sets SUSPENDED) or a tenant suspended in the 60
  // seconds since must not receive a session or a LOGIN row. The rule is the
  // callback's own (sso.service provisionUser, A-70) plus the tenant check
  // every sign-in point now makes (auth.service tenantRefusal). The code is
  // already spent, so a refused exchange cannot be retried.
  const user = await Users.findByPk(entry.userId, {
    attributes: ["id", "tenantId", "isActive", "status"],
    include: [tenantInclude()],
  });
  if (!user || !user.isActive || user.status !== "ACTIVE") {
    throw new AppError(403, "Account is suspended");
  }
  const refusal = tenantRefusal(user);
  if (refusal) {
    throw new AppError(403, refusal);
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
exports.OIDC_FLOW_TTL_SECONDS = OIDC_FLOW_TTL_SECONDS;
exports.OIDC_BINDING_COOKIE = OIDC_BINDING_COOKIE;
// Exported for tests that need a started sign-in without driving oidcLogin.
exports.beginOidcFlow = beginOidcFlow;
