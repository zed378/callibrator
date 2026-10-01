/**
 * A-288 (ADR-100) — a tenant's IP allowlist and geofence are enforced at
 * SIGN-IN.
 *
 * `networkSecurity.service#evaluateLoginSecurity` had no caller outside its own
 * route, so a tenant that configured an allowlist changed nothing. Every point
 * that issues a session now asks `assertSignInPermitted` first:
 *
 *   password   auth.service#loginUser — after the password and the A-83 tenant
 *              check, before the MFA token, the session and any one-time
 *              (bootstrap) sign-in
 *   mfa        auth.service#loginMfa — again, before the code is spent
 *   sso        sso.controller#issueSsoTokens — before the session
 *   passkey    webauthn verify-login — before the assertion counts
 *   refresh    auth.service#refreshUserToken — before the rotated session
 *
 * WHAT IS CHECKED
 *  - The IP allowlist (TenantSettings `ip_allowlist`, CIDRs), against req.ip
 *    (A-16: the edge-resolved client address). IPv4 and IPv6, and an
 *    IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) matches its IPv4 CIDR. An
 *    empty allowlist restricts nothing. Every path, refresh included: refresh
 *    runs at least every access-token lifetime, so leaving the allowed network
 *    ends the session at the next refresh.
 *  - The geofence (`geofence`: centre and radius), against a location the
 *    DEVICE reports in the sign-in body (`location: { latitude, longitude }`).
 *    There is no server-side geolocation in this deployment, so the geofence
 *    is an ATTESTATION: it keeps honest devices from signing in off-site; it
 *    does not stop an attacker, who can report any location. The allowlist is
 *    the network CONTROL. A tenant with a geofence and a sign-in without a
 *    location is refused (fail closed) with `code: "LOCATION_REQUIRED"`, so
 *    the page can ask the browser for one and retry. Checked on password, MFA
 *    and passkey sign-ins. NOT on SSO — a federated sign-in's authentication
 *    context (device, location) belongs to the identity provider's own
 *    conditional access — and not on refresh, which has no user present to
 *    attest a location.
 *
 * WHAT A REFUSAL SAYS — 403 with one fixed message whichever check failed,
 * never the allowlist, the geofence or the distance. It is answered only AFTER
 * the caller proved the credential (the A-83 rule), so it says nothing about
 * whether an account exists; the throttles in front of the password are
 * unchanged. Each refusal writes an audit row in the tenant (action LOGIN,
 * resourceType "SignInPolicy", `changes.outcome = "refused"`, the reason and
 * the address) in its own transaction — the refusal IS the event recorded.
 *
 * THE LOCK-OUT-SAFE PATH — a platform operator (super admin) is never refused
 * by a TENANT's policy. The operator's home is an ordinary hospital tenant
 * (A-125), whose administrators may set its allowlist (Q-38); were the policy
 * applied, a tenant could lock out the one account that recovers it. The
 * operator stays behind mandatory MFA (P6-07). A sign-in the policy would have
 * refused is still recorded, under PLATFORM, `outcome: "operator-exempt"`.
 */
import { BlockList, isIP } from "net";
import { z } from "zod";

import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { isPlatformOperator } from "../utils/mfaPolicy.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";

/** The one answer to every refusal (403). */
export const SIGN_IN_NOT_PERMITTED =
  "Sign-in is not permitted from this network or location. Contact your organisation's administrator.";
/** The answer when a geofence needs a location the sign-in did not carry (403). */
export const LOCATION_REQUIRED_MESSAGE =
  "Your organisation requires your device's location to sign in. Allow location access and try again.";

/** How a session is being issued. */
export type SignInMethod = "password" | "password+totp" | "password+recovery_code" | "sso" | "passkey" | "refresh";

/** The account signing in, as the sign-in points load it. */
export interface SignInPrincipal {
  id: string;
  tenantId?: string | null | undefined;
  roleId?: string | number | null | undefined;
  /** As loaded with the user; when absent it is read from `roleId`. */
  role?: { name?: string | null; roleLevel?: number | null } | null | undefined;
}

/**
 * The account's role: as loaded, else read by `roleId` (a refresh loads the
 * user bare), else by the account (the SSO exchange knows only its id). Only
 * reached when the policy would refuse.
 */
const roleOf = async (user: SignInPrincipal): Promise<{ name: string | null; roleLevel: number | null } | null> => {
  if (user.role !== undefined) {
    return user.role ? { name: user.role.name ?? null, roleLevel: user.role.roleLevel ?? null } : null;
  }
  let roleId = user.roleId;
  if (roleId === undefined) {
    const row = await models.Users.findByPk(user.id, { attributes: ["roleId"], skipTenantScope: true });
    roleId = row?.roleId ?? null;
  }
  if (roleId === null) {
    return null;
  }
  const role = await models.Role.findByPk(roleId, { attributes: ["name", "roleLevel"] });
  return role ? { name: role.name, roleLevel: role.roleLevel } : null;
};

/** What the request contributes. `location` is the raw body value; it is validated here. */
export interface SignInContext {
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  location?: unknown;
  method: SignInMethod;
}

/**
 * A refusal. `publicCode` reaches the response body as a top-level `code` in
 * every environment (controllerWrapper.util#sendCaughtError), so the sign-in
 * page can tell "ask for the location and retry" from a plain refusal.
 */
export class SignInRefusedError extends AppError {
  readonly publicCode: "LOCATION_REQUIRED" | "NETWORK_POLICY";

  constructor(code: "LOCATION_REQUIRED" | "NETWORK_POLICY") {
    super(403, code === "LOCATION_REQUIRED" ? LOCATION_REQUIRED_MESSAGE : SIGN_IN_NOT_PERMITTED);
    this.publicCode = code;
  }
}

/** Why a sign-in was refused. */
export type RefusalReason = "ip_allowlist" | "geofence" | "location_required";

/** A geofence as stored. */
export interface Geofence {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const geofenceSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  radiusKm: z.number().positive(),
});

/** Methods whose device can attest a location (see the header). */
const GEOFENCED_METHODS = new Set<SignInMethod>(["password", "password+totp", "password+recovery_code", "passkey"]);

/** `::ffff:10.1.2.3` → `10.1.2.3`; anything else unchanged. */
export const normaliseAddress = (ip: string): string => {
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed;
};

/**
 * Whether `ip` falls inside any of `cidrs`. A malformed entry matches nothing;
 * an unparsable address matches nothing (and so is refused by a non-empty list).
 *
 * @param ip - the client address
 * @param cidrs - `a.b.c.d`, `a.b.c.d/n`, or the IPv6 forms
 */
export const addressAllowed = (ip: string, cidrs: readonly string[]): boolean => {
  const address = normaliseAddress(ip);
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  const list = new BlockList();
  for (const cidr of cidrs) {
    const text = cidr.trim();
    const slash = text.indexOf("/");
    const range = slash < 0 ? text : text.slice(0, slash);
    const prefixText = slash < 0 ? undefined : text.slice(slash + 1);
    const rangeFamily = isIP(range);
    if (rangeFamily === 0) {
      continue;
    }
    const type = rangeFamily === 4 ? "ipv4" : "ipv6";
    const max = rangeFamily === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      continue;
    }
    list.addSubnet(range, prefix, type);
  }
  return list.check(address, family === 4 ? "ipv4" : "ipv6");
};

/** Great-circle distance in kilometres (haversine). */
export const distanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** A JSON setting value, or null when it is absent or not JSON. */
const parseSetting = (value: string | null | undefined): unknown => {
  try {
    return JSON.parse(value ?? "null") as unknown;
  } catch {
    return null;
  }
};

/** The tenant's allowlist and geofence. Explicit tenant predicate: sign-in runs with no tenant context. */
export const loadNetworkPolicy = async (
  tenantId: string,
): Promise<{ allowlist: string[]; geofence: Geofence | null }> => {
  const rows = await models.TenantSettings.findAll({
    where: { tenantId, key: ["ip_allowlist", "geofence"] },
    // One row per (tenant, key): at most two. Bounded explicitly (D-24).
    limit: 2,
    skipTenantScope: true,
  });
  let allowlist: string[] = [];
  let geofence: Geofence | null = null;
  for (const row of rows) {
    const value = parseSetting(row.value);
    if (row.key === "ip_allowlist") {
      allowlist = Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
    } else {
      const parsed = geofenceSchema.safeParse(value);
      geofence = parsed.success ? parsed.data : null;
    }
  }
  return { allowlist, geofence };
};

/**
 * The reason the policy refuses this sign-in, or null when it permits it.
 * Pure: no audit, no throw.
 */
export const policyRefusal = (
  policy: { allowlist: readonly string[]; geofence: Geofence | null },
  context: SignInContext,
): RefusalReason | null => {
  if (policy.allowlist.length > 0 && !addressAllowed(context.ip ?? "", policy.allowlist)) {
    return "ip_allowlist";
  }
  if (policy.geofence && GEOFENCED_METHODS.has(context.method)) {
    const location = locationSchema.safeParse(context.location);
    if (!location.success) {
      return "location_required";
    }
    const { latitude, longitude, radiusKm } = policy.geofence;
    if (distanceKm(location.data.latitude, location.data.longitude, latitude, longitude) > radiusKm) {
      return "geofence";
    }
  }
  return null;
};

/** Record the decision in its own transaction (the refusal is the event). */
const recordDecision = async (
  tenantId: string,
  userTenantId: string,
  user: SignInPrincipal,
  context: SignInContext,
  outcome: "refused" | "operator-exempt",
  reason: RefusalReason,
): Promise<void> => {
  await db.transaction(async (transaction) => {
    await auditService.logAction(
      {
        tenantId,
        userId: user.id,
        action: "LOGIN",
        resourceType: "SignInPolicy",
        resourceId: userTenantId,
        changes: { outcome, reason, method: context.method },
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
      { transaction },
    );
  });
};

/**
 * Refuse a sign-in the account's tenant does not permit from here (403), or
 * resolve. A no-op for an account with no tenant, and — after two indexed
 * reads — for a tenant with no allowlist and no geofence.
 *
 * @throws SignInRefusedError 403 (`code` LOCATION_REQUIRED or NETWORK_POLICY)
 */
export const assertSignInPermitted = async (user: SignInPrincipal, context: SignInContext): Promise<void> => {
  const tenantId = user.tenantId;
  if (!tenantId) {
    return;
  }
  const reason = policyRefusal(await loadNetworkPolicy(tenantId), context);
  if (!reason) {
    return;
  }
  if (isPlatformOperator({ role: await roleOf(user) })) {
    logger.warn("Sign-in outside the home tenant's network policy: platform operator exempt", {
      userId: user.id,
      reason,
      method: context.method,
    });
    await recordDecision(PLATFORM_TENANT_ID, tenantId, user, context, "operator-exempt", reason);
    return;
  }
  logger.warn("Sign-in refused by the tenant's network policy", {
    userId: user.id,
    tenantId,
    reason,
    method: context.method,
  });
  await recordDecision(tenantId, tenantId, user, context, "refused", reason);
  throw new SignInRefusedError(reason === "location_required" ? "LOCATION_REQUIRED" : "NETWORK_POLICY");
};

// ---------------------------------------------------------------------------
// Q-38 (ADR-100) — a tenant administrator sets their own tenant's allowlist
// and geofence, behind a SELF-LOCKOUT guard.
//
// A change that would refuse the caller's own next sign-in is refused with
// 409, explaining what to add. For the allowlist: the address the change is
// made from must be inside it. For a geofence: the change must carry the
// caller's current device location (`currentLocation`), and it must be inside
// the new fence. An empty allowlist cannot lock anyone out.
//
// A platform operator is not bound by a tenant's policy (above), so the guard
// does not apply to them: the operator's `/tenants/:tenantId/...` routes and
// the operator's own home-tenant change are the override.
// ---------------------------------------------------------------------------

/** The caller of a network-policy change. */
export interface PolicyChangeCaller {
  ip?: string | null | undefined;
  currentLocation?: unknown;
  role?: { name?: string | null; roleLevel?: number | null } | null | undefined;
}

/** A refused self-lockout: 409 with `code: "SELF_LOCKOUT"`. */
export class SelfLockoutError extends AppError {
  readonly publicCode = "SELF_LOCKOUT";

  constructor(message: string) {
    super(409, message);
  }
}

/**
 * Refuse (409) a change that would lock its own caller out.
 *
 * @param change - the new allowlist, or the new geofence
 * @param caller - the request's address, reported location and role
 * @throws SelfLockoutError
 */
export const assertChangeKeepsCaller = (
  change: { allowlist?: readonly string[]; geofence?: Geofence },
  caller: PolicyChangeCaller,
): void => {
  if (isPlatformOperator({ role: caller.role ?? null })) {
    return;
  }
  const ip = caller.ip ?? "";
  if (change.allowlist && change.allowlist.length > 0 && !addressAllowed(ip, change.allowlist)) {
    throw new SelfLockoutError(
      `This allowlist does not include the address you are connected from (${normaliseAddress(ip) || "unknown"}). ` +
        "Saving it would refuse your own next sign-in and end this session at its next refresh. " +
        "Add your address, or a range that contains it, and save again.",
    );
  }
  if (change.geofence) {
    const location = locationSchema.safeParse(caller.currentLocation);
    if (!location.success) {
      throw new SelfLockoutError(
        "Setting a geofence needs your device's current location (currentLocation: { latitude, longitude }), " +
          "so that it can be checked that you are inside the new area. Allow location access and save again.",
      );
    }
    const { latitude, longitude, radiusKm } = change.geofence;
    const distance = distanceKm(location.data.latitude, location.data.longitude, latitude, longitude);
    if (distance > radiusKm) {
      throw new SelfLockoutError(
        `Your current location is ${distance.toFixed(1)} km from the centre of this geofence, outside its ${String(radiusKm)} km radius. ` +
          "Saving it would refuse your own next sign-in. Widen the radius or move the centre, and save again.",
      );
    }
  }
};
