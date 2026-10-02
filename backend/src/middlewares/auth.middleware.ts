// P9-19 (ADR-087): converted from auth.middleware.js under the four
// tenantContext gates, behaviour unchanged (its interim `.d.ts` is deleted with
// it). What the JavaScript destructured at load is captured at load; the
// services (`authService`, `tenantService`, `apiKeyService`, `sessionService`)
// stay module objects, read at call time. The exports are `export =` of one
// object in the JavaScript's key order, and `auth` reads
// `PASSWORD_CHANGE_REQUIRED_CODE` off that object at call time, as the
// JavaScript read `exports.PASSWORD_CHANGE_REQUIRED_CODE`.
/* eslint-disable @typescript-eslint/no-confusing-void-expression -- as built: `return next()` / `return unauthorized(…)` return what they return, as the JavaScript did */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyAccessToken as loadedVerifyAccessToken } from "../utils/jwt.util";
import {
  unauthorized as loadedUnauthorized,
  forbidden as loadedForbidden,
  error as loadedErrorResponse,
} from "../utils/response.util";
// The JavaScript destructured `ROLE_NAMES` here and never used it; the barrel still loads at this point.
import "../constants";
import authService from "../services/auth.service";
import tenantService from "../services/tenant.service";
import apiKeyService from "../services/apiKey.service";
import sessionService from "../services/session.service";
import { logger as loadedLogger } from "./activityLog.middleware";
import { tenantContextMiddleware as loadedTenantContextMiddleware } from "./tenantContext.middleware";
import { runWithImpersonator as loadedRunWithImpersonator } from "../utils/auditActor.util";
import { isPlatformTenant as loadedIsPlatformTenant } from "../constants/platformTenant";
import { isActiveTenantStatus as loadedIsActiveTenantStatus } from "../constants/tenantStatus";
import {
  MFA_ENROLMENT_REQUIRED_CODE as LOADED_MFA_ENROLMENT_REQUIRED_CODE,
  mfaEnrolmentRequired as loadedMfaEnrolmentRequired,
} from "../utils/mfaPolicy.util";
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";

const verifyAccessToken = loadedVerifyAccessToken;
const unauthorized = loadedUnauthorized;
const forbidden = loadedForbidden;
const errorResponse = loadedErrorResponse;
const logger = loadedLogger;
const tenantContextMiddleware = loadedTenantContextMiddleware;
const runWithImpersonator = loadedRunWithImpersonator;
const isPlatformTenant = loadedIsPlatformTenant;
const isActiveTenantStatus = loadedIsActiveTenantStatus;
const MFA_ENROLMENT_REQUIRED_CODE = LOADED_MFA_ENROLMENT_REQUIRED_CODE;
const mfaEnrolmentRequired = loadedMfaEnrolmentRequired;

/** A verified access token's claims, as this middleware reads them. */
interface AccessClaims {
  id?: unknown;
  sid?: unknown;
  mfaRequired?: unknown;
  amr?: unknown;
  impersonatorId?: unknown;
}

/** The loaded principal, as this middleware reads it. */
interface LoadedUser {
  tenantId?: unknown;
  tenant?: { status?: unknown; [field: string]: unknown } | null;
  isActive?: unknown;
  status?: unknown;
  mustChangePassword?: unknown;
  readonly role?: { readonly name?: unknown } | null;
  isApiKey?: unknown;
  [field: string]: unknown;
}

/** What this middleware sets on the request beyond the shared augmentation. */
interface AuthRequestFields {
  user?: unknown;
  tenantId?: unknown;
  tenant?: unknown;
  mfaEnrolmentRequired?: boolean;
  token?: string;
  sessionId?: unknown;
  signInMethod?: string | null;
  impersonatorId?: string | null;
}

/** The request as this middleware writes it. */
type AuthRequest = Omit<Request, "user" | "tenantId" | "impersonatorId"> & AuthRequestFields;

/**
 * A-59 / P6-12 — an access token that names no session is REFUSED.
 *
 * Since A-59 every issuer of an access token sets `sid`: loginUser, loginMfa,
 * refreshUserToken, impersonateUser (auth.service.js) and both SSO callbacks
 * (sso.controller.js). The activation, MFA-pending and socket tokens are no
 * longer access tokens at all (jwt.util.js#generatePurposeToken). A sid-less
 * access token could only be one issued before that deploy, and it could not
 * be revoked — it lasted until its own `exp`.
 *
 * Flipped to `false` on 2026-09-27 (ADR-085). A-59 reached the VM no later
 * than the 2026-09-24 deploy (87de9bf), and the VM's JWT_ACCESS_EXPIRED is 1d,
 * so every sid-less token has expired: the flip signs nobody out. It is kept
 * as a named constant so the refusal is visible and pinned by a test, not so
 * it can be turned back on.
 */
const SIDLESS_ACCESS_TOKENS_ACCEPTED = false as boolean;

/**
 * Whether a loaded principal is the platform super admin — N-01: the one
 * predicate in utils/role.util.ts, which recognises both spellings.
 */
const isSuperAdminPrincipal = loadedIsSuperAdmin;

/**
 * A-101 — why this principal's tenant may not act, or null when it may. The
 * same rule as the sign-in points (auth.service.js `tenantRefusal`, A-83),
 * kept here rather than imported because most suites replace auth.service
 * with a double that has only the loader.
 *
 * A user whose tenantId names no tenant the include can see is refused as
 * deleted: getAuthUserWithTenant loads the tenant through the Tenant model's
 * default scope (isDeleted = false) and paranoid, so a soft-deleted or
 * destroyed tenant comes back as `tenant: null`. This used to let the request
 * through — only a VISIBLE suspended/deleted tenant was refused — so a
 * soft-deleted tenant's users kept working on any unexpired session although
 * none of them could sign in again.
 *
 * A principal with no tenantId (a platform super admin need not have one) is
 * never refused here. A super admin whose home tenant is gone is refused like
 * anyone else — as sign-in already refuses them; tenant.service deleteTenant
 * refuses a tenant that still has users, which is what keeps the default
 * tenant (home of the seeded super admin) from being deleted under them.
 *
 * @param user - `{ tenantId?, tenant?: { status? } | null }`
 * @returns the refusal message (answered with 403)
 */
const tenantRefusal = (user: LoadedUser): string | null => {
  if (!user.tenantId) {
    return null;
  }
  // A-125 follow-up: the reserved PLATFORM tenant is not a customer and is
  // nobody's workplace but the operator's. A non-super-admin account whose
  // home is PLATFORM (it can only get there by a direct database write or a
  // bug upstream) is refused outright — otherwise it would act inside the
  // tenant that holds the platform audit trail. The Tenant model's
  // excludePlatformTenant hook does NOT cover the include that loads
  // `user.tenant`, so the tenant row alone would have let it through.
  if (isPlatformTenant(user.tenantId as Parameters<typeof isPlatformTenant>[0]) && !isSuperAdminPrincipal(user)) {
    return "Tenant account is not available";
  }
  if (!user.tenant) {
    return "Tenant account is deleted";
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: `String(status || "")`
  const status = String(user.tenant.status || "").toLowerCase();
  return status === "suspended" || status === "deleted"
    ? `Tenant account is ${status}`
    : null;
};

/**
 * F-8 — the impersonating super admin named by a VERIFIED access token, or
 * null. Only impersonateUser (auth.service.js) sets the claim, and only a
 * non-empty string is taken: the value is written into audit_logs, so anything
 * else is ignored rather than trusted. Never read from a body, header or query.
 */
/**
 * A-123 (ADR-051 Q-11) — the routes an account flagged `mustChangePassword`
 * may still call: change the password, sign out, and "who am I" (which is how
 * the frontend learns about the flag). Every other authenticated route
 * answers 403 PASSWORD_CHANGE_REQUIRED until the password is changed.
 *
 * Matched on method + the FULL path (router mount + route), so a same-named
 * route under another router is not let through.
 */
const PASSWORD_CHANGE_ALLOWED = new Set([
  "POST /api/v1/auth/just-update-password",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/logout-all",
  "POST /api/v1/auth/verify",
]);

const PASSWORD_CHANGE_REQUIRED_CODE = "PASSWORD_CHANGE_REQUIRED";

/**
 * A-160 — the routes an account that must enrol MFA (the tenant's "MFA
 * required" policy, utils/mfaPolicy.util.js) may still call: start and
 * confirm an enrolment, sign out, "who am I" (which is how the frontend
 * learns about it), and change password — an account can be under A-123's
 * forced change AND this policy at once, and the password gate runs first,
 * so without it neither gate could ever be cleared.
 *
 * Matched on method + the FULL path, as PASSWORD_CHANGE_ALLOWED is.
 */
const MFA_ENROLMENT_ALLOWED = new Set([
  "POST /api/v1/auth/mfa/setup",
  "POST /api/v1/auth/mfa/verify",
  "POST /api/v1/auth/just-update-password",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/logout-all",
  "POST /api/v1/auth/verify",
]);

/** The request's method and full path, as the two allow-lists key them. */
const routeKey = (req: Request): string => `${req.method} ${req.baseUrl || ""}${req.path || ""}`;

/**
 * Whether an account that must enrol MFA is refused on this request.
 *
 * @param user - req.user
 * @param req - the request
 * @param impersonatorId - the impersonating super admin, if any
 * @param method - A-160: the token's `amr` (signInMethodFrom)
 * @returns whether to refuse
 */
const mustEnrolMfaFirst = (user: LoadedUser, req: Request, impersonatorId: string | null, method: string | null): boolean =>
  mfaEnrolmentRequired(user as Parameters<typeof mfaEnrolmentRequired>[0], impersonatorId, { method }) &&
  !MFA_ENROLMENT_ALLOWED.has(routeKey(req));

/**
 * Whether a flagged account must be refused on this request.
 *
 * An impersonation token is not refused: the impersonating super admin is
 * not the account holder, cannot change the holder's password, and the
 * forced change protects the holder's credential, not the support session.
 *
 * @param user - req.user
 * @param req - the request
 * @param impersonatorId - the impersonating super admin, if any
 * @returns whether to refuse
 */
const mustChangePasswordFirst = (user: LoadedUser, req: Request, impersonatorId: string | null): boolean =>
  Boolean(user.mustChangePassword) &&
  !impersonatorId &&
  !PASSWORD_CHANGE_ALLOWED.has(routeKey(req));

/**
 * A-160: the access token's `amr` claim — how its session signed in
 * ("password", "password+totp", "saml", "oidc", …) — or null.
 *
 * @param decoded - verified access-token payload
 * @returns the method, or null
 */
const signInMethodFrom = (decoded: AccessClaims): string | null =>
  typeof decoded.amr === "string" && decoded.amr ? decoded.amr : null;

const impersonatorFrom = (decoded: AccessClaims): string | null =>
  typeof decoded.impersonatorId === "string" && decoded.impersonatorId
    ? decoded.impersonatorId
    : null;

/**
 * A-48. Whether the session a verified access token was issued with is still
 * live. A token with no `sid` predates the claim and cannot be tied to a
 * session; see SIDLESS_ACCESS_TOKENS_ACCEPTED.
 *
 * @param decoded - verified access-token payload
 * @returns whether the session is usable
 */
const sessionIsUsable = async (decoded: AccessClaims): Promise<boolean> =>
  decoded.sid
    ? sessionService.isSessionLive(decoded.sid as string, decoded.id)
    : SIDLESS_ACCESS_TOKENS_ACCEPTED;

// Resolve an `Authorization: ApiKey <key>` header to a synthetic, scoped
// service-account principal. Returns true if it handled the request (called
// next or sent a response), false if the header isn't an API key.
const tryApiKeyAuth = async (req: Request, res: Response, next: NextFunction): Promise<boolean> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty header is ""
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("ApiKey ")) {
    return false;
  }
  const rawKey = authHeader.slice("ApiKey ".length).trim();
  const key = await apiKeyService.verifyApiKey(rawKey);
  if (!key) {
    unauthorized(res, "Invalid or expired API key");
    return true;
  }
  const keyTenant = (key as unknown as { tenant?: { status?: unknown } | null }).tenant;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: `key.tenant && String(status || "")`
  const tenantStatus = keyTenant && String(keyTenant.status || "").toLowerCase();
  if (tenantStatus === "suspended" || tenantStatus === "deleted") {
    forbidden(res, `Tenant account is ${tenantStatus}`);
    return true;
  }
  // Synthetic principal — carries a non-privileged role name so downstream
  // authorization takes the API-key (scope) path, never the role matrix.
  const r = req as unknown as AuthRequest;
  r.user = {
    id: key.id,
    tenantId: key.tenantId,
    isApiKey: true,
    apiKeyScopes: Array.isArray(key.scopes) ? key.scopes : [],
    role: { id: null, name: "API_KEY" },
    tenant: keyTenant,
  };
  r.tenantId = key.tenantId;
  r.tenant = keyTenant;
  tenantContextMiddleware(req, res, next);
  return true;
};

/**
 * Authentication Middleware
 * Validates JWT token, checks user status and session
 * Attaches tenant context when available
 */
const auth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // ==========================================
    // API KEY AUTH (Authorization: ApiKey <key>)
    // ==========================================
    if (await tryApiKeyAuth(req, res, next)) {
      return;
    }

    // ==========================================
    // TOKEN EXTRACTION
    // ==========================================

    const authHeader = req.headers.authorization;

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the tests the JavaScript made, in its order
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return unauthorized(res, "Unauthorized");
    }

    const token = authHeader.split(" ")[1] as string;

    // ==========================================
    // VERIFY JWT
    // ==========================================

    const decoded = verifyAccessToken(token) as AccessClaims;

    // ==========================================
    // MFA-PENDING TOKEN IS NOT AN ACCESS TOKEN
    // ==========================================
    // When an MFA-enabled account passes the first factor, loginUser issues a
    // short-lived token carrying `mfaRequired: true`. That token is ONLY valid
    // for exchange at POST /auth/mfa/login after the second factor — it must
    // never grant access to protected resources. Reject it here.
    //
    // Since A-59 that token is typ "mfa", which verifyAccessToken above already
    // refuses; this check remains for one minted as an access token before
    // that deploy (they live five minutes).
    if (decoded.mfaRequired) {
      return unauthorized(res, "MFA verification required");
    }

    // ==========================================
    // SESSION STILL LIVE (A-48)
    // ==========================================
    // Revoking a session (logout, an administrator's revoke, a password
    // change, refresh-token rotation) must stop the access token issued with
    // it on the next request, not when the token expires. Cached in Redis;
    // see session.service.js#isSessionLive for the Redis-down behaviour.
    if (!(await sessionIsUsable(decoded))) {
      return unauthorized(res, "Session has been revoked or has expired");
    }

    // ==========================================
    // FETCH USER WITH ROLE AND TENANT
    // ==========================================

    const user = (await authService.getAuthUserWithTenant(decoded.id as string)) as LoadedUser | null;

    if (!user) {
      return unauthorized(res, "User not found");
    }

    // ==========================================
    // CHECK USER STATUS
    // ==========================================

    if (!user.isActive) {
      return forbidden(res, "Account banned");
    }

    // A-180: "erased" — a GDPR-anonymised account (gdpr.service).
    if (user.status === "INACTIVE" || user.status === "SUSPENDED" || user.status === "erased") {
      return forbidden(res, `Account is ${user.status.toLowerCase()}`);
    }

    // ==========================================
    // FORCED PASSWORD CHANGE (A-123, ADR-051 Q-11)
    // ==========================================
    // An administrator chose this account's password, and a password signs
    // (ADR-047). Until the holder replaces it, only change-password, logout
    // and "who am I" are answered; the frontend redirects on this code.
    if (mustChangePasswordFirst(user, req, impersonatorFrom(decoded))) {
      return errorResponse(
        res,
        "You must change the password an administrator set for you before continuing",
        403,
        null,
        { code: authMiddleware.PASSWORD_CHANGE_REQUIRED_CODE },
      );
    }

    // ==========================================
    // TENANT "MFA REQUIRED" POLICY (A-160)
    // ==========================================
    // The user's tenant requires MFA and this account has none. Until it
    // enrols, only the enrolment routes, change-password, logout and "who am
    // I" are answered; the frontend sends it to the MFA page on this code.
    const impersonatorId = impersonatorFrom(decoded);
    // A-160: how the session signed in (`amr`, set by every issuer of an
    // access token since 0052) — a federated session answers to its IdP's MFA.
    const signInMethod = signInMethodFrom(decoded);
    if (mustEnrolMfaFirst(user, req, impersonatorId, signInMethod)) {
      return errorResponse(
        res,
        "Your organisation requires multi-factor authentication. Set it up before continuing",
        403,
        null,
        { code: MFA_ENROLMENT_REQUIRED_CODE },
      );
    }

    // ==========================================
    // ATTACH USER TO REQUEST
    // ==========================================

    const r = req as unknown as AuthRequest;
    r.user = user;
    // A-160: /auth/verify reports it, so the frontend can go to the MFA page
    // before a request is refused.
    r.mfaEnrolmentRequired = mfaEnrolmentRequired(user as Parameters<typeof mfaEnrolmentRequired>[0], impersonatorId, {
      method: signInMethod,
    });
    r.token = token;
    // P6-12: always set here — a token without `sid` was refused above.
    r.sessionId = decoded.sid;
    // A-216: how this session signed in — a federated one's password (and
    // address, A-214) belong to its identity provider.
    r.signInMethod = signInMethod;
    // F-8: the super admin acting through this token, when it is an
    // impersonation token. Every audit row the request writes names them.
    r.impersonatorId = impersonatorId;

    // Attach tenant context from user
    if (user.tenantId) {
      const refusal = tenantRefusal(user);
      if (refusal) {
        return forbidden(res, refusal);
      }
      r.tenantId = user.tenantId;
      r.tenant = user.tenant;
    }

    // Only allow explicit tenant header overrides if user is SUPER_ADMIN.
    // Tenant-bound and tenant-less non-super-admin accounts must NEVER be able
    // to select a tenant via request headers — doing so would let any
    // authenticated user operate inside an attacker-chosen tenant.
    if (isSuperAdminPrincipal(user)) {
      const tenantCode = req.headers["x-tenant-code"];
      const tenantIdHeader = req.headers["x-tenant-id"];

      if (tenantCode) {
        const tenant =
          await tenantService.getTenantByCodeForMiddleware(tenantCode as string);
        if (tenant) {
          r.tenant = tenant;
          r.tenantId = tenant.id;
        }
      }

      if (tenantIdHeader) {
        const tenant =
          await tenantService.getTenantByIdForMiddleware(tenantIdHeader as Parameters<typeof tenantService.getTenantByIdForMiddleware>[0]);
        // A-143: `tenants.status` is a lower-case ENUM; comparing it with
        // "ACTIVE" never matched, so this override never applied.
        if (tenant && isActiveTenantStatus(tenant.status)) {
          r.tenant = tenant;
          r.tenantId = tenant.id;
        }
      }
    }

    // The session is carried in a request context as well as on req, because
    // POST /auth/logout reaches authService.logoutSession() without `req`.
    sessionService.runWithSession(r.sessionId as string | null, () =>
      runWithImpersonator(r.impersonatorId, () =>
        tenantContextMiddleware(req, res, next),
      ),
    );
    // As built: the JavaScript fell off the end here (undefined), stated for noImplicitReturns.
    return undefined;
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the message is interpolated whatever its type
    logger.error(`AUTH MIDDLEWARE ERROR: ${(error as { message?: unknown }).message}`, (error as { stack?: unknown }).stack);
    return unauthorized(res, "Invalid token");
  }
};

/**
 * Optional auth middleware
 * Doesn't fail if no token is provided
 */
const optionalAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the tests the JavaScript made, in its order
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1] as string;
    const decoded = verifyAccessToken(token) as AccessClaims;

    // A revoked session's token is treated as no token at all.
    const user = ((await sessionIsUsable(decoded))
      ? await authService.getAuthUserWithTenant(decoded.id as string)
      : null) as LoadedUser | null;

    // A-101: a principal whose tenant is suspended or gone is treated as no
    // principal at all — optional auth never refuses, it just does not attach.
    // A-123: nor does it attach an account that must change its password
    // first (unless impersonated) — it is anonymous until it has. A-160: nor
    // one that must enrol MFA first.
    const r = req as unknown as AuthRequest;
    if (
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the tests the JavaScript made, in its order
      user &&
      user.isActive &&
      (user.status === "ACTIVE" || user.status === "INACTIVE") &&
      !tenantRefusal(user) &&
      !mustChangePasswordFirst(user, req, impersonatorFrom(decoded)) &&
      !mustEnrolMfaFirst(user, req, impersonatorFrom(decoded), signInMethodFrom(decoded))
    ) {
      r.user = user;
      r.impersonatorId = impersonatorFrom(decoded);
      if (user.tenantId) {
        r.tenantId = user.tenantId;
      }
    }

    runWithImpersonator(r.impersonatorId, () =>
      tenantContextMiddleware(req, res, next),
    );
  } catch {
    // Continue without auth
    tenantContextMiddleware(req, res, next);
  }
};

/**
 * Reject API-key principals. Apply to sensitive endpoints (e.g. managing API
 * keys themselves) so a scoped service account cannot escalate privileges.
 */
const denyApiKey: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the two tests the JavaScript made
  if (req.user && req.user.isApiKey) {
    return forbidden(res, "API keys cannot access this endpoint");
  }
  next();
  // As built: undefined after next(), stated for noImplicitReturns.
  return undefined;
};

// A-03. An API key is a scoped credential, but only `dynamicAccess` ever read
// its scopes — on a route without one the key was simply "an authenticated
// principal" and got everything the handler offered. Authorization for API
// keys is therefore deny-by-default: a gate that has actually authorized the
// key sets `req.apiKeyAuthorized`, and a key that reaches a controller without
// it is refused (see utils/controllerWrapper.util.ts).
//
// V-05: exactly TWO places set it — dynamicAccess's scope check and the SCIM
// gate (scim.route.ts#requireApiKeyOrAdmin, which authorizes a key by its
// `scim` scope). The unconditional `allowApiKey` opt-in that used to live here
// had no call site and was removed: a gate that authorizes a key must check
// something about it. tests/guards/apiKeyAuthorizedWriters.v05.guard.test.ts
// enumerates the writers and fails on a third.

/**
 * Super admin only middleware
 */
const superAdminOnly: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the tests the JavaScript made, in its order
    !req.user ||
    !req.user.role ||
    // V-15 / N-01: both spellings, as every other gate.
    !isSuperAdminPrincipal(req.user)
  ) {
    return forbidden(res, "Super admin access required");
  }
  next();
  // As built: undefined after next(), stated for noImplicitReturns.
  return undefined;
};

/** The module's exports, in the JavaScript's key order (plain, writable properties). */
const authMiddleware = {
  SIDLESS_ACCESS_TOKENS_ACCEPTED,
  PASSWORD_CHANGE_ALLOWED,
  PASSWORD_CHANGE_REQUIRED_CODE,
  MFA_ENROLMENT_ALLOWED,
  MFA_ENROLMENT_REQUIRED_CODE,
  auth,
  optionalAuth,
  denyApiKey,
  superAdminOnly,
};

export = authMiddleware;
