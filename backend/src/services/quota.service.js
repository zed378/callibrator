// src/services/quota.service.js
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

const { Tenant, User } = require("../models");
const models = require("../models");

const BYTES_PER_MB = 1024 * 1024;

// Plan → unlocked features. Higher tiers are supersets of lower ones.
const PLAN_FEATURES = {
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

const getTenant = (tenantId) => (tenantId ? Tenant.findByPk(tenantId) : null);

// A limit of null/undefined or a negative number means "unlimited".
const isUnlimited = (limit) => limit === null || limit === undefined || limit < 0;

// ------------------------------------------------------------------
// SEATS
// ------------------------------------------------------------------
const getSeatUsage = (tenantId) =>
  // default scope excludes soft-deleted users → each remaining account = 1 seat
  User.count({ where: { tenantId } });

const checkSeatQuota = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { allowed: true, used: 0, limit: null, unlimited: true };
  }
  const limit = tenant.limitSeats;
  const used = await getSeatUsage(tenantId);
  if (isUnlimited(limit)) {
    return { allowed: true, used, limit, unlimited: true };
  }
  return { allowed: used < limit, used, limit, unlimited: false };
};

// ------------------------------------------------------------------
// STORAGE
// ------------------------------------------------------------------
const getStorageUsageMb = async (tenantId) => {
  const Attachment = models.Attachment;
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
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
const hasOwnStorage = async (tenantId) => {
  try {
    const storageConfig = require("./storage/config.service");
    return Boolean(await storageConfig.getTenantConfig(tenantId));
  } catch {
    return false;
  }
};

const checkStorageQuota = async (tenantId, incomingBytes = 0) => {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { allowed: true, usedMb: 0, limitMb: null, unlimited: true };
  }
  const limitMb = tenant.limitStorageMb;
  const usedMb = await getStorageUsageMb(tenantId);
  const incomingMb = (incomingBytes || 0) / BYTES_PER_MB;
  if (isUnlimited(limitMb)) {
    return { allowed: true, usedMb, limitMb, incomingMb, unlimited: true };
  }
  const allowed = usedMb + incomingMb <= limitMb;
  return {
    allowed,
    usedMb,
    limitMb,
    incomingMb,
    unlimited: false,
    // Only on a refusal: the upload is refused although the tenant has its
    // own bucket, and the message must say why (ADR-084, Q-06).
    ...(allowed ? {} : { ownStorage: await hasOwnStorage(tenantId) }),
  };
};

// ------------------------------------------------------------------
// FEATURES
// ------------------------------------------------------------------
const planHasFeature = (plan, feature) => {
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.free;
  return features.includes(feature);
};

const checkFeature = async (tenantId, feature) => {
  const tenant = await getTenant(tenantId);
  const plan = tenant?.plan || "free";
  return { allowed: planHasFeature(plan, feature), plan, feature };
};

// ------------------------------------------------------------------
// SUMMARY (for the usage endpoint / frontend gating)
// ------------------------------------------------------------------
const getUsageSummary = async (tenantId) => {
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
    features: PLAN_FEATURES[tenant.plan] || PLAN_FEATURES.free,
    seats: { used: seatUsed, limit: tenant.limitSeats },
    storage: {
      usedMb: Math.round(storageMb * 100) / 100,
      limitMb: tenant.limitStorageMb,
    },
  };
};

module.exports = {
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
