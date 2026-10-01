// src/services/quota.service.ts
//
// P9-17 (ADR-087, Stage C leaves): converted from quota.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). `Tenant` and `User` are destructured from the
// barrel once at load, as before; `Attachment` is still read from the barrel at
// call time; `storage/config.service` is still required lazily inside
// `hasOwnStorage`, so a failure to load it still reads as "no own storage".
//
// Plan quotas & feature gating for tenants. Reads the limits stored on the
// Tenant model (limitSeats, limitStorageMb, plan) and reports current usage.
//
// - Seats: counts non-deleted user accounts for the tenant.
// - Storage: sums Attachment sizes. The Attachment registry now exists, so this
//   reports real usage and storage enforcement is active (see
//   middlewares/enforceQuota.middleware.js). A tenant with its own bucket is
//   counted too, because its uploads are still written to platform storage
//   (ADR-084, Q-06).
// - Features: PLAN_FEATURES maps each plan to the capabilities it unlocks;
//   requireFeature() (in middlewares/enforceQuota.js) gates routes on these.

import models from "../models";
import type StorageConfigService from "./storage/config.service";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { Tenant, User } = models;

type TenantRow = ModelInstance<"Tenant">;

/** Plan → the features it unlocks; any other plan reads as `free`. */
interface PlanFeatures {
  free: string[];
  professional: string[];
  business: string[];
  enterprise: string[];
  [plan: string]: string[] | undefined;
}

/** A limit as the Tenant row holds it: null, undefined or negative is unlimited. */
type Limit = number | null | undefined;

const BYTES_PER_MB = 1024 * 1024;

// Plan → unlocked features. Higher tiers are supersets of lower ones.
const PLAN_FEATURES: PlanFeatures = {
  free: ["core"],
  professional: ["core", "reports", "webhooks"],
  business: ["core", "reports", "webhooks", "api_keys", "sso", "search"],
  enterprise: [
    "core",
    "reports",
    "webhooks",
    "api_keys",
    "sso",
    "search",
    "audit_export",
    "custom_branding",
  ],
};

const PLAN_ORDER = ["free", "professional", "business", "enterprise"];

const getTenant = (tenantId: TenantId | null | undefined): Promise<TenantRow | null> | null =>
  tenantId ? Tenant.findByPk(tenantId) : null;

// A limit of null/undefined or a negative number means "unlimited".
const isUnlimited = (limit: Limit): boolean => limit === null || limit === undefined || limit < 0;

// ------------------------------------------------------------------
// SEATS
// ------------------------------------------------------------------
const getSeatUsage = (tenantId: TenantId | null | undefined): Promise<number> =>
  // default scope excludes soft-deleted users → each remaining account = 1 seat
  // As built: an absent tenant id is passed through to the where clause.
  User.count({ where: { tenantId: tenantId as TenantId } });

interface SeatQuota {
  allowed: boolean;
  used: number;
  limit: Limit;
  unlimited: boolean;
}

const checkSeatQuota = async (tenantId: TenantId | null | undefined): Promise<SeatQuota> => {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { allowed: true, used: 0, limit: null, unlimited: true };
  }
  const limit = tenant.limitSeats;
  const used = await getSeatUsage(tenantId);
  if (isUnlimited(limit)) {
    return { allowed: true, used, limit, unlimited: true };
  }
  return { allowed: used < (limit as number), used, limit, unlimited: false };
};

// ------------------------------------------------------------------
// STORAGE
// ------------------------------------------------------------------
const getStorageUsageMb = async (tenantId: TenantId | null | undefined): Promise<number> => {
  const Attachment = models.Attachment;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the registry is checked, so a barrel without Attachment (a test double) still answers 0
  if (!Attachment || !tenantId) {
    return 0; // no central registry yet (File/Document module not installed)
  }
  const bytes = await Attachment.sum("size", { where: { tenantId } });
  return (bytes || 0) / BYTES_PER_MB;
};

// ADR-084 (Q-06): limitStorageMb bounds the bytes the PLATFORM holds for a
// tenant. Every upload is still written to platform storage — the request path
// was never cut over to services/storage (docs/STORAGE/04), and the migration
// tool copies and leaves the legacy file in place — so every attachment counts,
// including those of a tenant that has configured its own bucket. Exempting
// such a tenant today would give it unbounded PLATFORM disk. The exemption
// becomes true per attachment, not per tenant, once an attachment's bytes live
// only in the tenant's own storage; that is a change to getStorageUsageMb, made
// with the cutover.

/**
 * Whether the tenant has configured its own storage. Read only to explain a
 * refusal; an unreadable configuration explains nothing rather than turning
 * the refusal into a 500.
 *
 * @param tenantId - the tenant whose storage configuration is read
 */
const hasOwnStorage = async (tenantId: TenantId): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded on first use, inside the try, so a load failure reads as "no own storage"
    const storageConfig = require("./storage/config.service") as typeof StorageConfigService;
    return Boolean(await storageConfig.getTenantConfig(tenantId));
  } catch {
    return false;
  }
};

interface StorageQuota {
  allowed: boolean;
  usedMb: number;
  limitMb: Limit;
  incomingMb?: number;
  unlimited: boolean;
  ownStorage?: boolean;
}

const checkStorageQuota = async (
  tenantId: TenantId | null | undefined,
  incomingBytes: number | null = 0,
): Promise<StorageQuota> => {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { allowed: true, usedMb: 0, limitMb: null, unlimited: true };
  }
  const limitMb = tenant.limitStorageMb;
  const usedMb = await getStorageUsageMb(tenantId);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `incomingBytes || 0`
  const incomingMb = (incomingBytes || 0) / BYTES_PER_MB;
  if (isUnlimited(limitMb)) {
    return { allowed: true, usedMb, limitMb, incomingMb, unlimited: true };
  }
  const allowed = usedMb + incomingMb <= (limitMb as number);
  return {
    allowed,
    usedMb,
    limitMb,
    incomingMb,
    unlimited: false,
    // Only on a refusal: the upload is refused although the tenant has its
    // own bucket, and the message must say why (ADR-084, Q-06).
    // tenantId is set: the tenant was found by it above.
    ...(allowed ? {} : { ownStorage: await hasOwnStorage(tenantId as TenantId) }),
  };
};

// ------------------------------------------------------------------
// FEATURES
// ------------------------------------------------------------------
const planHasFeature = (plan: string, feature: string): boolean => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.free;
  return features.includes(feature);
};

const checkFeature = async (
  tenantId: TenantId | null | undefined,
  feature: string,
): Promise<{ allowed: boolean; plan: string; feature: string }> => {
  const tenant = await getTenant(tenantId);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty plan also reads as free
  const plan = tenant?.plan || "free";
  return { allowed: planHasFeature(plan, feature), plan, feature };
};

// ------------------------------------------------------------------
// SUMMARY (for the usage endpoint / frontend gating)
// ------------------------------------------------------------------
interface UsageSummary {
  plan: TenantRow["plan"];
  status: TenantRow["status"];
  features: string[];
  seats: { used: number; limit: Limit };
  storage: { usedMb: number; limitMb: Limit };
}

const getUsageSummary = async (tenantId: TenantId | null | undefined): Promise<UsageSummary | null> => {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return null;
  }
  const [seatUsed, storageMb] = await Promise.all([
    getSeatUsage(tenantId),
    getStorageUsageMb(tenantId),
  ]);
  return {
    plan: tenant.plan,
    status: tenant.status,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`; a null plan keys as "null", as before
    features: PLAN_FEATURES[String(tenant.plan)] || PLAN_FEATURES.free,
    seats: { used: seatUsed, limit: tenant.limitSeats },
    storage: {
      usedMb: Math.round(storageMb * 100) / 100,
      limitMb: tenant.limitStorageMb,
    },
  };
};

export = {
  PLAN_FEATURES,
  PLAN_ORDER,
  getSeatUsage,
  checkSeatQuota,
  getStorageUsageMb,
  checkStorageQuota,
  planHasFeature,
  checkFeature,
  getUsageSummary,
};
