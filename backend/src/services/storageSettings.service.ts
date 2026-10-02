/**
 * Tenant-facing storage settings.
 *
 * Thin orchestration over services/storage: read/write a tenant's storage
 * override, prove the configuration actually works before saving it, and report
 * usage. The heavy lifting (drivers, key isolation, KMS encryption) lives in
 * services/storage; this layer is what the controller talks to.
 *
 * P9-18 (ADR-087, Stage C): converted from storageSettings.service.js with no
 * behaviour change, under the four isolation gates. `export =` keeps the
 * object `require()` returned (the same keys, in the same order). `storage`
 * and `storageConfig` are read at call time through their objects; `AppError`
 * and the logger are captured at load, as the `.js` destructured them.
 */

import storage from "./storage";
import storageConfig from "./storage/config.service";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";

const AppError = LoadedAppError;
const logger = loadedLogger;

/** A stored tenant configuration, as getTenantConfig answers it (credentials merged in). */
interface StoredConfig {
  provider?: unknown;
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
  bucket?: unknown;
  region?: unknown;
  endpoint?: unknown;
  forcePathStyle?: unknown;
  prefix?: unknown;
  root?: unknown;
  fsync?: unknown;
}

/** The secret-free view a caller receives. */
type PublicView = Record<string, unknown>;

/** What a caller passes to updateSettings (validated by config.service). */
type SettingsInput = Parameters<typeof storageConfig.setTenantConfig>[1] & {
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
};

/**
 * The safe, secret-free view of a tenant's storage configuration.
 * Credentials are NEVER returned — only whether they are set.
 */
const publicView = (config: StoredConfig | null | undefined): PublicView => {
  if (!config) {
    return { provider: "default", usingPlatformDefault: true };
  }
  const view: PublicView = {
    provider: config.provider,
    usingPlatformDefault: false,
    hasCredentials: Boolean(config.accessKeyId && config.secretAccessKey),
  };
  if (config.provider === "s3") {
    view["bucket"] = config.bucket;
    view["region"] = config.region;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty endpoint reads as none
    view["endpoint"] = config.endpoint || null;
    view["forcePathStyle"] = config.forcePathStyle;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty prefix reads as none
    view["prefix"] = config.prefix || null;
  } else if (config.provider === "nfs") {
    view["root"] = config.root;
    view["fsync"] = config.fsync;
  }
  return view;
};

/** Read a tenant's storage settings (safe view). */
const getSettings = async (tenantId: TenantId | null | undefined): Promise<PublicView> => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  const config = (await storageConfig.getTenantConfig(tenantId)) as StoredConfig | null;
  return publicView(config);
};

/**
 * Persist a tenant's storage override, but only after a live health check
 * proves the credentials/endpoint actually work — otherwise a typo would
 * silently route every future upload into a black hole.
 */
const updateSettings = async (
  tenantId: TenantId | null | undefined,
  input: SettingsInput,
  actor: AuditActorInput | null = null,
): Promise<PublicView> => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}

  // Validate shape first (cheap, no I/O), then probe connectivity with a
  // throwaway driver built from the candidate config — never from the cache.
  const validated = storageConfig.validateTenantConfig(input);
  const probe = storage.buildProbeDriver({
    ...validated,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty credential reads as none
    accessKeyId: input.accessKeyId || null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty credential reads as none
    secretAccessKey: input.secretAccessKey || null,
  });
  const health = await probe.healthCheck();
  if (!health.ok) {
    throw new AppError(
      422,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty error reads as "unreachable"
      `Storage connection test failed: ${health.error || "unreachable"}`,
    );
  }

  await storageConfig.setTenantConfig(tenantId, input, actor);
  // A cached driver for this tenant now points at the OLD config; drop it so
  // the next request rebuilds from the new settings — on every replica (A-40).
  await storage.invalidate(tenantId);

  logger.info("Tenant storage settings updated", {
    tenantId,
    provider: validated.provider,
  });
  return getSettings(tenantId);
};

/** Revert a tenant to the platform default. */
const clearSettings = async (
  tenantId: TenantId | null | undefined,
  actor: AuditActorInput | null = null,
): Promise<PublicView> => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  await storageConfig.clearTenantConfig(tenantId, actor);
  await storage.invalidate(tenantId);
  logger.info("Tenant storage settings cleared", { tenantId });
  return getSettings(tenantId);
};

/** Run a health check against the tenant's ACTIVE storage. */
const testConnection = async (tenantId: TenantId | null | undefined): Promise<{ ok: boolean; error?: string | undefined }> => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  const scoped = await storage.getTenantStorage(tenantId);
  return scoped.healthCheck();
};

/** Bytes + object count the tenant is currently storing (metering input). */
const getUsage = async (
  tenantId: TenantId | null | undefined,
): Promise<{ bytes: number; objects: number; megabytes: number; provider: string }> => {
  if (!tenantId) {throw new AppError(400, "A tenant is required");}
  const scoped = await storage.getTenantStorage(tenantId);
  const usage = await scoped.usage();
  return {
    ...usage,
    megabytes: Math.round((usage.bytes / (1024 * 1024)) * 100) / 100,
    provider: scoped.provider,
  };
};

export = {
  getSettings,
  updateSettings,
  clearSettings,
  testConnection,
  getUsage,
  publicView,
};
