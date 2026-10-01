// P9-13 (ADR-087, Stage C): converted from networkSecurity.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned
// (the same keys, in the same order; every function was already named). The
// functions call each other directly, as before. Every load-time destructure
// is kept as a capture at load (`logger`, `TenantSettings`, `Tenant`, `db`,
// `PLATFORM_TENANT_ID`, `AppError`, `addressAllowed`, `auditEntryActor`,
// `actorChanges`); `auditService` is the module object.
import type { Transaction } from "sequelize";

import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import models from "../models";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { addressAllowed as loadedAddressAllowed } from "./signInPolicy.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";

const logger = loadedLogger;
const { TenantSettings, Tenant } = models;
const db = loadedDb;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const AppError = LoadedAppError;
const addressAllowed = loadedAddressAllowed;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

/** A stored geofence, as setTenantGeofence writes it. */
interface Geofence {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/** The body of a geofence change (validated by the route). */
interface GeofenceInput {
  latitude: number;
  longitude: number;
  radiusKm?: number | null | undefined;
}

/**
 * A-280 (ADR-094) — the allowlist and geofence are set by the platform
 * operator, for their home tenant (`PUT /ip-allowlist`) or for a tenant they
 * name in the path (`PUT /tenants/:tenantId/...`). Each change is recorded
 * under PLATFORM and under the tenant, in the change's transaction (the A-165
 * rule): who changed where a tenant may sign in from, from what, to what.
 *
 * @param {object} transaction
 * @param {{userId?: (string|null), apiKeyId?: (string|null), ipAddress?: (string|null), userAgent?: (string|null)}} actor - auditPrincipal(req)
 * @param {string} tenantId
 * @param {string} operation
 * @param {*} before
 * @param {*} after
 */
const auditSettingChange = async (
  transaction: Transaction,
  actor: AuditActorInput,
  tenantId: TenantId,
  operation: string,
  before: unknown,
  after: unknown,
): Promise<void> => {
  // A-282 (ADR-100): the principal the one way (an API key would be
  // `system:api-key` with `changes.apiKeyId`, never a user id).
  const entry = {
    ...auditEntryActor(actor),
    action: "UPDATE" as const,
    resourceType: "TenantSettings",
    resourceId: tenantId,
    changes: { operation, before, after, ...actorChanges(actor) },
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId }, { transaction });
};

/**
 * A-280 — a tenant the operator names must exist. The PLATFORM tenant is
 * hidden by the Tenant model's hooks, so it is 404 like an unknown id.
 *
 * @param {string} tenantId
 */
async function assertTenantExists(tenantId: TenantId): Promise<void> {
  const tenant = tenantId ? await Tenant.findByPk(tenantId) : null;
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }
}

const DEFAULT_GEOFENCE_RADIUS_KM = 50;

// A-288 (ADR-100): one matcher for the evaluation route and the sign-in
// enforcement (signInPolicy.service#addressAllowed): IPv4 and IPv6, and an
// IPv4-mapped IPv6 client address (`::ffff:a.b.c.d`, what Node reports on a
// dual-stack socket) matches its IPv4 range. The old IPv4-only parse refused
// every such address.
function isInCidr(ip: unknown, cidr: string): boolean {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: any falsy address reads as "", anything else is coerced as a JavaScript caller passes it
  return addressAllowed(String(ip || ""), [cidr]);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getTenantIpAllowlist(tenantId: TenantId): Promise<string[]> {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: "ip_allowlist" },
  });

  if (!setting) {
    return [];
  }

  try {
    // The stored value is what setTenantIpAllowlist wrote from a validated list.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty stored value reads as "[]"
    return JSON.parse(setting.value || "[]") as string[];
  } catch {
    return [];
  }
}

async function setTenantIpAllowlist(
  tenantId: TenantId,
  cidrs: string[],
  actor: AuditActorInput = {},
): Promise<{ tenantId: TenantId; allowlist: string[] }> {
  const before = await getTenantIpAllowlist(tenantId);
  await db.transaction(async (transaction) => {
    await TenantSettings.upsert(
      {
        tenantId,
        key: "ip_allowlist",
        value: JSON.stringify(cidrs),
      },
      { transaction },
    );
    await auditSettingChange(transaction, actor, tenantId, "SET_IP_ALLOWLIST", before, cidrs);
  });

  return { tenantId, allowlist: cidrs };
}

async function checkIpAllowlist(
  tenantId: TenantId,
  ip: unknown,
): Promise<{ allowed: boolean; reason: "no_restrictions" } | { allowed: boolean; ip: unknown; allowlist: string[] }> {
  const allowlist = await getTenantIpAllowlist(tenantId);

  if (allowlist.length === 0) {
    return { allowed: true, reason: "no_restrictions" };
  }

  const allowed = allowlist.some((cidr) => isInCidr(ip, cidr));

  if (!allowed) {
    logger.warn("IP not in allowlist", { tenantId, ip, allowlist });
  }

  return { allowed, ip, allowlist };
}

async function getTenantGeofence(tenantId: TenantId): Promise<Geofence | null> {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: "geofence" },
  });

  if (!setting) {
    return null;
  }

  try {
    // The stored value is what setTenantGeofence wrote.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty stored value reads as "null"
    return JSON.parse(setting.value || "null") as Geofence | null;
  } catch {
    return null;
  }
}

async function setTenantGeofence(
  tenantId: TenantId,
  geofence: GeofenceInput,
  actor: AuditActorInput = {},
): Promise<{ tenantId: TenantId; geofence: Geofence }> {
  const payload = {
    latitude: geofence.latitude,
    longitude: geofence.longitude,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a radius of 0 falls back to the default, which `??` would not do
    radiusKm: geofence.radiusKm || DEFAULT_GEOFENCE_RADIUS_KM,
  };

  const before = await getTenantGeofence(tenantId);
  await db.transaction(async (transaction) => {
    await TenantSettings.upsert(
      {
        tenantId,
        key: "geofence",
        value: JSON.stringify(payload),
      },
      { transaction },
    );
    await auditSettingChange(transaction, actor, tenantId, "SET_GEOFENCE", before, payload);
  });

  return { tenantId, geofence: payload };
}

async function checkGeofence(
  tenantId: TenantId,
  // P9-20: optional in the type as in fact (evaluateLoginSchema); a missing coordinate reads NaN.
  latitude: number | undefined,
  longitude: number | undefined,
): Promise<{ allowed: boolean; reason: "no_geofence" } | { allowed: boolean; distanceKm: number; radiusKm: number }> {
  const geofence = await getTenantGeofence(tenantId);

  if (!geofence) {
    return { allowed: true, reason: "no_geofence" };
  }

  // As built: a missing coordinate stays undefined, the arithmetic reads NaN, and NaN <= radius is
  // false, so a login without a location is outside the geofence (fail closed).
  const distance = haversineKm(latitude as number, longitude as number, geofence.latitude, geofence.longitude);
  const allowed = distance <= geofence.radiusKm;

  if (!allowed) {
    logger.warn("Geofence check failed", { tenantId, latitude, longitude, distance, radiusKm: geofence.radiusKm });
  }

  return { allowed, distanceKm: distance, radiusKm: geofence.radiusKm };
}

async function evaluateLoginSecurity(
  tenantId: TenantId,
  ip: unknown,
  latitude: number | undefined,
  longitude: number | undefined,
): Promise<{
  allowed: boolean;
  ip: Awaited<ReturnType<typeof checkIpAllowlist>>;
  geofence: Awaited<ReturnType<typeof checkGeofence>>;
  requiresStepUp: boolean;
}> {
  const ipCheck = await checkIpAllowlist(tenantId, ip);
  const geoCheck = await checkGeofence(tenantId, latitude, longitude);

  const allowed = ipCheck.allowed && geoCheck.allowed;

  return {
    allowed,
    ip: ipCheck,
    geofence: geoCheck,
    requiresStepUp: !allowed,
  };
}

const service = {
  assertTenantExists,
  getTenantIpAllowlist,
  setTenantIpAllowlist,
  checkIpAllowlist,
  getTenantGeofence,
  setTenantGeofence,
  checkGeofence,
  evaluateLoginSecurity,
  DEFAULT_GEOFENCE_RADIUS_KM,
};

export = service;
