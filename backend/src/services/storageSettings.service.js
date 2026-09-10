/**
 * Tenant-facing storage settings.
 *
 * Thin orchestration over services/storage: read/write a tenant's storage
 * override, prove the configuration actually works before saving it, and report
 * usage. The heavy lifting (drivers, key isolation, KMS encryption) lives in
 * services/storage; this layer is what the controller talks to.
 */

const storage = require("./storage");
const storageConfig = require("./storage/config.service");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");

/**
 * The safe, secret-free view of a tenant's storage configuration.
 * Credentials are NEVER returned — only whether they are set.
 */
const publicView = (config) => {
  if (!config) {
    return { provider: "default", usingPlatformDefault: true };
  }
  const view = {
    provider: config.provider,
    usingPlatformDefault: false,
    hasCredentials: Boolean(config.accessKeyId && config.secretAccessKey),
  };
  if (config.provider === "s3") {
    view.bucket = config.bucket;
    view.region = config.region;
    view.endpoint = config.endpoint || null;
    view.forcePathStyle = config.forcePathStyle;
    view.prefix = config.prefix || null;
  } else if (config.provider === "nfs") {
    view.root = config.root;
    view.fsync = config.fsync;
  }
  return view;
};

/** Read a tenant's storage settings (safe view). */
const getSettings = async (tenantId) => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  const config = await storageConfig.getTenantConfig(tenantId);
  return publicView(config);
};

/**
 * Persist a tenant's storage override, but only after a live health check
 * proves the credentials/endpoint actually work — otherwise a typo would
 * silently route every future upload into a black hole.
 */
const updateSettings = async (tenantId, input) => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}

  // Validate shape first (cheap, no I/O), then probe connectivity with a
  // throwaway driver built from the candidate config — never from the cache.
  const validated = storageConfig.validateTenantConfig(input);
  const probe = storage.buildProbeDriver({
    ...validated,
    accessKeyId: input.accessKeyId || null,
    secretAccessKey: input.secretAccessKey || null,
  });
  const health = await probe.healthCheck();
  if (!health.ok) {
    throw new AppError(
      422,
      `Storage connection test failed: ${health.error || "unreachable"}`,
    );
  }

  await storageConfig.setTenantConfig(tenantId, input);
  // A cached driver for this tenant now points at the OLD config; drop it so
  // the next request rebuilds from the new settings.
  storage.invalidate(tenantId);

  logger.info("Tenant storage settings updated", {
    tenantId,
    provider: validated.provider,
  });
  return getSettings(tenantId);
};

/** Revert a tenant to the platform default. */
const clearSettings = async (tenantId) => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  await storageConfig.clearTenantConfig(tenantId);
  storage.invalidate(tenantId);
  logger.info("Tenant storage settings cleared", { tenantId });
  return getSettings(tenantId);
};

/** Run a health check against the tenant's ACTIVE storage. */
const testConnection = async (tenantId) => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  const scoped = await storage.getTenantStorage(tenantId);
  return scoped.healthCheck();
};

/** Bytes + object count the tenant is currently storing (metering input). */
const getUsage = async (tenantId) => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  const scoped = await storage.getTenantStorage(tenantId);
  const usage = await scoped.usage();
  return {
    ...usage,
    megabytes: Math.round((usage.bytes / (1024 * 1024)) * 100) / 100,
    provider: scoped.provider,
  };
};

module.exports = {
  getSettings,
  updateSettings,
  clearSettings,
  testConnection,
  getUsage,
  publicView,
};
