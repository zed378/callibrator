// P9-20 (ADR-087; converted under the four isolation gates): from
// sso.controller.js with no behaviour change. `export =` keeps the exact
// object `require()` returned, with the keys in the order the `.js` assigned
// them (ssoLogin, SSO_ERROR_CODES, SSO_UNAVAILABLE, ssoUnavailable,
// withSsoRefusalFloor, ssoCallback, ssoMetadata, oidcLogin, oidcCallback,
// ssoExchange, HANDOFF_TTL_SECONDS, OIDC_FLOW_TTL_SECONDS, OIDC_BINDING_COOKIE,
// beginOidcFlow, startSsoFor). `crypto`, the services and `signInPolicy` are
// the module objects; every other load-time destructure is kept as a capture
// at load. The environment is read at call time through config/env, as the
// `.js` read `process.env` at call time.
import crypto from "crypto";
import type { Request, Response } from "express";

import ssoService from "../services/sso.service";
import oidcJwks from "../services/oidcJwks";
import tenantService from "../services/tenant.service";
import auditService from "../services/audit.service";
import redis from "../services/redis.service";
import rateLimiter from "../services/rateLimiter.redis.service";
import models from "../models";
import authService from "../services/auth.service";
import {
  generateAccessToken as loadedGenerateAccessToken,
  generateOpaqueRefreshToken as loadedGenerateOpaqueRefreshToken,
} from "../utils/jwt.util";
import sessionService from "../services/session.service";
import { ssoLoginSchema as loadedSsoLoginSchema } from "../validators/sso.validator";
import { checkInput as loadedCheckInput } from "../validators/input";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess, login as loadedLogin } from "../utils/response.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
// A-288 (ADR-100): the tenant's IP allowlist at the SSO sign-in.
import * as signInPolicy from "../services/signInPolicy.service";
import { env, envOr, isProduction } from "../config/env";
import type { TenantId, UserId } from "../types/ids";

const { noteAuthFailure } = rateLimiter;
const { Tenants, Users, sequelize } = models;
const { tenantInclude, tenantRefusal } = authService;
const generateAccessToken = loadedGenerateAccessToken;
const generateOpaqueRefreshToken = loadedGenerateOpaqueRefreshToken;
const { createSession } = sessionService;
const ssoLoginSchema = loadedSsoLoginSchema;
const checkInput = loadedCheckInput;
const AppError = LoadedAppError;
const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const login = loadedLogin;
const logger = loadedLogger;

/** A tenant's SSO settings, as sso.service reads them (getTenantSettings answers each value as stored). */
type SsoSettings = Parameters<typeof ssoService.generateAuthnRequest>[1] & { sso_enabled?: unknown };

/** What a hand-off code stands for (A-60). */
interface HandoffEntry {
  userId: UserId;
  email: string;
  tenantId: TenantId;
  ipAddress: string;
  userAgent: string;
  method: string;
}

/** What an OIDC sign-in's state stands for (A-68). */
interface OidcFlowEntry {
  tenantCode: string;
  redirectUri: string;
  nonce: string;
  codeVerifier: string;
  bindingHash: string;
}

/** A thrown value, as the refusal paths read it. */
interface Thrown {
  message?: unknown;
  status?: number;
  statusCode?: number;
  ssoCode?: string;
}

/** The tenant row the SSO flows read. */
interface SsoTenant {
  id: TenantId;
  code: string | null;
}

/** The provisioned user the hand-off names. */
interface SsoUser {
  id: UserId;
  email: string;
}

// A-292 (ADR-100): every way an SSO start can fail for the organisation code —
// no such tenant, SSO disabled, no SAML entry point, no OIDC client — is ONE
// answer, so the endpoint no longer tells anyone which codes are customers
// and which of them use SSO. The real reason is logged for the operator.
const SSO_UNAVAILABLE = "Single sign-on is not available for this organisation code";

/**
 * Refuse an SSO start with the one indistinguishable answer (404).
 *
 * @param {string} reason - logged, never sent
 * @param {string} tenantCode
 * @returns {never}
 */
const ssoUnavailable: (reason: string, tenantCode: unknown) => never = (reason, tenantCode) => {
  logger.info("SSO start refused", { reason, tenantCode });
  throw new AppError(404, SSO_UNAVAILABLE);
};

/**
 * ADR-100 amendment (2026-09-30) — the refusal's TIMING is not an oracle
 * either. An unknown code is refused after one query; a known code without SSO
 * after two. Every SSO_UNAVAILABLE refusal is therefore held until at least
 * SSO_REFUSAL_FLOOR_MS (default 400 ms) after the start was received, which
 * is longer than either path takes, so the two cannot be told apart by
 * latency. Only refusals wait: a successful start is already distinguishable
 * by its answer. Residual: a refusal whose own work exceeds the floor (an
 * enabled tenant whose IdP discovery document is slow or down) is still slower.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} work
 * @returns {F}
 */
const withSsoRefusalFloor = <A extends unknown[], R>(work: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
  const started = Date.now();
  try {
    return await work(...args);
  } catch (err) {
    // As built: `err && err.message === …` tolerates a thrown non-object.
    if (err && (err as Thrown).message === SSO_UNAVAILABLE) {
      const floor = Number(env("SSO_REFUSAL_FLOOR_MS") ?? 400);
      const wait = floor - (Date.now() - started);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw err;
  }
};

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
const handoffKey = (code: string): string =>
  `sso:handoff:${crypto.createHash("sha256").update(code).digest("hex")}`;

const memoryHandoffs = new Map<string, { entry: HandoffEntry; expiresAt: number }>();

const pruneMemoryHandoffs = (now: number): void => {
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
const issueHandoffCode = async (entry: HandoffEntry): Promise<string> => {
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
const redeemHandoffCode = async (code: string): Promise<HandoffEntry | null> => {
  const key = handoffKey(code);
  const fromRedis = await redis.getDel(key);
  if (fromRedis && typeof fromRedis === "object") {
    return fromRedis as HandoffEntry;
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
const handoffRedirect = async (req: Request, res: Response, tenant: SsoTenant, user: SsoUser, method: string): Promise<void> => {
  const code = await issueHandoffCode({
    userId: user.id,
    email: user.email,
    tenantId: tenant.id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as ""
    ipAddress: req.ip || "",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty agent reads as ""
    userAgent: req.headers["user-agent"] || "",
    method,
  });
  const frontendUrl = envOr("FRONTEND_URL", "http://localhost:3000");
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

const sha256Hex = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
const oidcFlowKey = (state: string): string => `sso:oidc:state:${sha256Hex(state)}`;
const randomToken = (): string => crypto.randomBytes(32).toString("base64url");

const memoryOidcFlows = new Map<string, { entry: OidcFlowEntry; expiresAt: number }>();

const bindingCookieOptions = (): { httpOnly: true; secure: boolean; sameSite: "lax"; path: string } => ({
  httpOnly: true,
  secure: isProduction(),
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
const beginOidcFlow = async (
  tenantCode: string,
  redirectUri: string,
): Promise<{ state: string; nonce: string; codeChallenge: string; binding: string }> => {
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
const consumeOidcFlow = async (state: unknown, binding: string | null): Promise<OidcFlowEntry | null> => {
  // As built: the state is coerced as the IdP sent it.
  const key = oidcFlowKey(String(state));
  let entry = (await redis.getDel(key)) as OidcFlowEntry | null;
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
const readCookie = (header: string | undefined, name: string): string | null => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion -- as built: a missing header reads as ""; the value is coerced as the `.js` coerced it
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
 * @returns {Promise<{accessToken: string, refreshToken: string, session: object}>}
 */
const issueSsoTokens = async (entry: HandoffEntry): Promise<{ accessToken: string; refreshToken: string; session: { id: string } }> => {
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
        // As built: an empty address or agent reads as null (`||`).
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

  // P6-02 (ADR-077): the refresh token goes back too — it was generated,
  // stored as the session's key and then dropped, so an SSO session could
  // never be renewed (the sso-session route reads `refreshToken`).
  return { accessToken, refreshToken, session };
};

/** The tenant's SSO settings, as the `.js` read them (`data?.settings || {}`). */
const settingsOf = (settingsResult: { data?: { settings?: unknown } | null }): SsoSettings =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `settingsResult.data?.settings || {}`
  (settingsResult.data?.settings || {}) as SsoSettings;

/**
 * Handle SSO Login Redirect generation
 */
const ssoLogin = asyncHandler(withSsoRefusalFloor(async (req: Request, res: Response) => {
  // A-68 (found in passing): the check answers `{ ok, value }` / `{ ok, errors }`,
  // not the value itself; destructuring `tenantCode` from the answer gave
  // undefined — and Sequelize throws on `where: { code: undefined }`.
  const checked = checkInput(req.body, ssoLoginSchema);
  if (!checked.ok) {
    throw new AppError(400, "Tenant code is required");
  }
  const { tenantCode } = checked.value;

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    return ssoUnavailable("no such tenant", tenantCode);
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
  const ssoSettings = settingsOf(settingsResult);

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    ssoUnavailable("SSO is not enabled", tenantCode);
  }

  if (!ssoSettings.sso_idp_entry_point) {
    ssoUnavailable("SSO entry point is not configured for this tenant", tenantCode);
  }

  const redirectUrl = ssoService.generateAuthnRequest(tenant.code as string, ssoSettings);

  success(res, { redirectUrl }, null, "SAML redirect URL generated", 200);
  return undefined;
}));

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
const callbackRefusal = (message: string, status: number, ssoCode: string): LoadedAppError & { ssoCode: string } =>
  Object.assign(new AppError(status, message), { ssoCode });

/**
 * The code a refused callback is answered with.
 *
 * @param {{ssoCode?: string, status?: number, statusCode?: number}} err
 * @returns {string}
 */
const refusalCode = (err: Thrown): string => {
  if (err.ssoCode) {
    return err.ssoCode;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls through
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
const refuseToLoginPage = (protocol: string, handler: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  try {
    await handler(req, res);
  } catch (caught) {
    const err = caught as Thrown;
    const code = refusalCode(err);
    logger.warn("SSO callback refused", {
      protocol,
      code,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status falls through
      status: err.status || err.statusCode || 500,
      reason: err.message,
    });
    const target = new URL("/login", envOr("FRONTEND_URL", "http://localhost:3000"));
    target.searchParams.set("error", code);
    res.redirect(target.toString());
  }
};

/**
 * Handle SAML ACS Callback
 */
const ssoCallback = asyncHandler(refuseToLoginPage("saml", async (req, res) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { SAMLResponse, RelayState } = (req.body as { SAMLResponse?: string; RelayState?: string } | undefined) || {};
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty path code falls back to RelayState
  const tenantCode = req.params["tenantCode"] || RelayState;

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
  const ssoSettings = settingsOf(settingsResult);

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw callbackRefusal("SSO is not enabled for this tenant", 400, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const userData = await ssoService.parseAndVerifyResponse(SAMLResponse, ssoSettings);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…]`
  const user = await ssoService.provisionUser(tenant.id, userData, { ipAddress: req.ip ?? null, userAgent: req.headers?.["user-agent"] ?? null });

  await handoffRedirect(req, res, tenant, user, "saml");
}));

/**
 * Handle SAML SP Metadata endpoint
 */
const ssoMetadata = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty path code falls back to the query
  const tenantCode = req.params["tenantCode"] || (req.query as { tenantCode?: string }).tenantCode;

  if (!tenantCode) {
    throw new AppError(400, "Tenant code is required");
  }

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id);
  const ssoSettings = settingsOf(settingsResult);

  const hostUrl = envOr("HOST_URL", "http://localhost:5000");
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: an empty setting falls back; the values are interpolated as stored */
  const spEntityId = ssoSettings.sso_sp_entity_id || `${hostUrl}/api/v1/auth/sso/metadata/${tenant.code}`;
  const acsUrl = ssoSettings.sso_sp_callback_url || `${hostUrl}/api/v1/auth/sso/callback/${tenant.code}`;

  const metadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor entityID="${spEntityId}" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="1" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions */

  res.set("Content-Type", "application/xml");
  res.status(200).send(metadataXml);
});

/**
 * Handle OIDC Login Redirect generation
 */
const oidcLogin = asyncHandler(withSsoRefusalFloor(async (req: Request, res: Response) => {
  // A-68 (found in passing): the check answers `{ ok, value }` / `{ ok, errors }`,
  // not the value itself; destructuring `tenantCode` from the answer gave
  // undefined — and Sequelize throws on `where: { code: undefined }`.
  const checked = checkInput(req.body, ssoLoginSchema);
  if (!checked.ok) {
    throw new AppError(400, "Tenant code is required");
  }
  const { tenantCode } = checked.value;

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    return ssoUnavailable("no such tenant", tenantCode);
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
  const ssoSettings = settingsOf(settingsResult);

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    ssoUnavailable("SSO is not enabled", tenantCode);
  }

  if (!ssoSettings.oidc_client_id) {
    ssoUnavailable("OIDC is not configured for this tenant", tenantCode);
  }

  // A-68: redirect_uri is fixed HERE and stored with the state, so the token
  // exchange sends exactly the value the authorize request did.
  const hostUrl = envOr("HOST_URL", "http://localhost:5000");
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: an empty setting falls back; the code is interpolated as stored
  const redirectUri = (ssoSettings.oidc_redirect_uri || `${hostUrl}/api/v1/auth/sso/oidc/callback/${tenant.code}`);
  // A-188: the IdP's own authorization endpoint, from its discovery document
  // (a missing or multi-tenant authority is refused here, before any state).
  const provider = await oidcJwks.discover(ssoSettings);
  const flow = await beginOidcFlow(tenant.code as string, redirectUri);

  const redirectUrl = ssoService.generateOidcAuthRequest(tenant.code as string, ssoSettings, {
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
  return undefined;
}));

/**
 * Handle OIDC Callback
 */
const oidcCallback = asyncHandler(refuseToLoginPage("oidc", async (req, res) => {
  // A-68/A-69: the IdP returns with a GET (?code&state, response_mode=query);
  // a POSTed form body is still read.
  const merged: { code?: unknown; state?: unknown } = { ...req.query, ...(req.body as object | undefined) };
  const { code, state } = merged;

  if (!code || !state) {
    throw callbackRefusal("Authorization code and state are required", 400, SSO_ERROR_CODES.STATE);
  }

  // A-68: consume the state once, bound to this browser; the binding cookie is
  // spent with it whatever the outcome.
  const flow = await consumeOidcFlow(state, readCookie(req.headers.cookie, OIDC_BINDING_COOKIE));
  res.clearCookie(OIDC_BINDING_COOKIE, bindingCookieOptions());
  if (!flow || (req.params["tenantCode"] && req.params["tenantCode"] !== flow.tenantCode)) {
    throw callbackRefusal("Invalid or expired SSO sign-in state", 401, SSO_ERROR_CODES.STATE);
  }
  const { tenantCode } = flow;

  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    throw callbackRefusal("Tenant not found", 404, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const settingsResult = await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS);
  const ssoSettings = settingsOf(settingsResult);

  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    throw callbackRefusal("SSO is not enabled for this tenant", 400, SSO_ERROR_CODES.UNAVAILABLE);
  }

  const userData = await ssoService.verifyOidcCallback(code, ssoSettings, flow.redirectUri, {
    nonce: flow.nonce,
    codeVerifier: flow.codeVerifier,
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…]`
  const user = await ssoService.provisionUser(tenant.id, userData, { ipAddress: req.ip ?? null, userAgent: req.headers?.["user-agent"] ?? null });

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
const ssoExchange = asyncHandler(async (req: Request, res: Response) => {
  const entry = await redeemHandoffCode((req.body as { code: string }).code);

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

  // A-288 (ADR-100): the tenant's IP allowlist, before the session. The
  // geofence is not asked here: a federated sign-in's device and location
  // context belong to the identity provider's own conditional access.
  await signInPolicy.assertSignInPermitted(
    { id: user.id, tenantId: user.tenantId },
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: empty values read as null
    { ip: req.ip || null, userAgent: req.headers?.["user-agent"] || null, method: "sso" },
  );

  const { accessToken, refreshToken, session } = await issueSsoTokens(entry);

  login(
    res,
    { id: entry.userId, email: entry.email, tenantId: entry.tenantId },
    accessToken,
    session,
    { refreshToken },
  );
});

// ---------------------------------------------------------------------------
// P10-04 (ADR-098 §7.2) — ONE SSO START, THE PROTOCOL DECIDED BY THE SERVER
//
// The sign-in page never asks the user "SAML or OIDC?": POST /auth/sso/start
// { orgCode } and the identifier-first discovery (POST /auth/login/discover,
// by email domain) both come here. OIDC when the tenant has an OIDC client,
// else SAML when it has an entry point. EVERY refusal — no such tenant, SSO
// off, neither protocol configured, the IdP's discovery document unreachable
// or refusing — is the ONE A-292 answer (ssoUnavailable, 404), the real reason
// logged. The per-protocol builders are the same ones /sso/login and
// /sso/oidc/login use; only the choice between them is new.
// ---------------------------------------------------------------------------

/**
 * Start SSO for an organisation code: the IdP redirect URL, and for OIDC the
 * browser-binding cookie set on `res`.
 *
 * @param {string} tenantCode
 * @param {object} res - the Express response (OIDC sets its binding cookie)
 * @returns {Promise<{redirectUrl: string, protocol: "oidc"|"saml"}>}
 * @throws {AppError} 404 SSO_UNAVAILABLE for every refusal
 */
const startSsoFor = withSsoRefusalFloor(async (tenantCode: string, res: Response): Promise<{ redirectUrl: string; protocol: "oidc" | "saml" }> => {
  const tenant = await Tenants.findOne({ where: { code: tenantCode } });
  if (!tenant) {
    return ssoUnavailable("no such tenant", tenantCode);
  }
  // The tenant was just found, so its settings answer carries data.
  const ssoSettings = ((await tenantService.getTenantSettings(tenant.id, SSO_SETTINGS)).data as { settings: SsoSettings }).settings;
  if (ssoSettings.sso_enabled !== "true" && ssoSettings.sso_enabled !== true) {
    ssoUnavailable("SSO is not enabled", tenantCode);
  }

  if (ssoSettings.oidc_client_id) {
    const hostUrl = envOr("HOST_URL", "http://localhost:5000");
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: an empty setting falls back; the code is interpolated as stored
    const redirectUri = (ssoSettings.oidc_redirect_uri || `${hostUrl}/api/v1/auth/sso/oidc/callback/${tenant.code}`);
    let provider;
    try {
      provider = await oidcJwks.discover(ssoSettings);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the message is interpolated as thrown
      ssoUnavailable(`OIDC discovery failed: ${(err as Thrown).message}`, tenantCode);
    }
    const flow = await beginOidcFlow(tenant.code as string, redirectUri);
    const redirectUrl = ssoService.generateOidcAuthRequest(tenant.code as string, ssoSettings, {
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
    return { redirectUrl, protocol: "oidc" };
  }

  if (ssoSettings.sso_idp_entry_point) {
    return { redirectUrl: ssoService.generateAuthnRequest(tenant.code as string, ssoSettings), protocol: "saml" };
  }

  return ssoUnavailable("neither OIDC nor SAML is configured for this tenant", tenantCode);
});

const controller = {
  ssoLogin,
  SSO_ERROR_CODES,
  // A-292 (ADR-100): the one SSO-start refusal, for every route that starts SSO.
  SSO_UNAVAILABLE,
  ssoUnavailable,
  withSsoRefusalFloor,
  ssoCallback,
  ssoMetadata,
  oidcLogin,
  oidcCallback,
  ssoExchange,
  HANDOFF_TTL_SECONDS,
  OIDC_FLOW_TTL_SECONDS,
  OIDC_BINDING_COOKIE,
  // Exported for tests that need a started sign-in without driving oidcLogin.
  beginOidcFlow,
  startSsoFor,
};

export = controller;
