/**
 * Storage configuration: the platform default, and each tenant's own override.
 *
 * This is the cost lever behind the whole storage module. A tenant that brings
 * its own bucket pays its own storage bill and is no longer bounded by the
 * platform's per-tenant quota; a tenant that does not falls back to the shared
 * platform bucket.
 *
 *   1. tenant-configured provider  (TenantSettings, credentials KMS-encrypted)
 *   2. global default provider     (environment)
 *
 * Non-secret settings live in `storage_config`; credentials live in
 * `storage_credentials`, which the TenantSettings model envelope-encrypts.
 */

const { TenantSettings } = require("../../models");
const { AppError } = require("../../utils/appError.util");
const storagePath = require("../../utils/storagePath.util");

const CONFIG_KEY = "storage_config";
const CREDENTIALS_KEY = "storage_credentials";

const PROVIDERS = Object.freeze(["local", "s3", "nfs"]);

/** Read the platform-wide default from the environment. */
const getGlobalConfig = () => {
  const provider = (process.env.STORAGE_DRIVER || "local").toLowerCase();

  if (!PROVIDERS.includes(provider)) {
    throw new AppError(
      500,
      `Invalid STORAGE_DRIVER "${provider}" (expected: ${PROVIDERS.join(", ")})`,
    );
  }

  if (provider === "s3") {
    if (!process.env.STORAGE_S3_BUCKET) {
      throw new AppError(500, "STORAGE_DRIVER=s3 requires STORAGE_S3_BUCKET");
    }
    return {
      provider: "s3",
      bucket: process.env.STORAGE_S3_BUCKET,
      region: process.env.STORAGE_S3_REGION || "us-east-1",
      endpoint: process.env.STORAGE_S3_ENDPOINT || null,
      // Operator-configured, therefore exempt from the SSRF guard: a MinIO
      // sidecar or in-cluster gateway is legitimately an internal address.
      // Tenant-supplied endpoints never get this flag.
      endpointTrusted: true,
      forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE !== "false",
      prefix: process.env.STORAGE_S3_PREFIX || null,
      // Absent credentials means the SDK's ambient chain (IAM role), which is
      // the right setup for a platform-owned bucket.
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID || null,
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY || null,
    };
  }

  if (provider === "nfs") {
    if (!process.env.STORAGE_NFS_ROOT) {
      throw new AppError(500, "STORAGE_DRIVER=nfs requires STORAGE_NFS_ROOT");
    }
    return {
      provider: "nfs",
      root: process.env.STORAGE_NFS_ROOT,
      // Default ON: an NFS client can otherwise acknowledge a write that is
      // still only in its own page cache.
      fsync: process.env.STORAGE_NFS_FSYNC !== "false",
    };
  }

  return {
    provider: "local",
    root: process.env.STORAGE_LOCAL_ROOT || storagePath("storage"),
    fsync: false,
  };
};

/** Validate a tenant-supplied configuration before it is persisted or used. */
const validateTenantConfig = (config) => {
  if (!config || typeof config !== "object") {
    throw new AppError(400, "Storage configuration is required");
  }
  const provider = String(config.provider || "").toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new AppError(
      400,
      `Invalid storage provider "${config.provider}" (expected: ${PROVIDERS.join(", ")})`,
    );
  }

  if (provider === "s3") {
    if (!config.bucket) {
      throw new AppError(400, "S3 storage requires a bucket");
    }
    return {
      provider,
      bucket: String(config.bucket),
      region: config.region ? String(config.region) : "us-east-1",
      endpoint: config.endpoint ? String(config.endpoint) : null,
      forcePathStyle: config.forcePathStyle !== false,
      prefix: config.prefix ? String(config.prefix) : null,
    };
  }

  if (provider === "nfs") {
    if (!config.root) {
      throw new AppError(400, "NFS storage requires a mount root");
    }
    return {
      provider,
      root: String(config.root),
      fsync: config.fsync !== false,
    };
  }

  // A tenant cannot point the `local` driver at an arbitrary server path —
  // that would be a read/write primitive on the app server's filesystem.
  // Local storage is the platform default only, configured from env.
  throw new AppError(
    400,
    "The 'local' provider cannot be configured per tenant; use s3 or nfs",
  );
};

/** Read a tenant's storage override, or null when it uses the platform default. */
const getTenantConfig = async (tenantId) => {
  if (!tenantId) {return null;}

  const rows = await TenantSettings.findAll({
    where: { tenantId, key: [CONFIG_KEY, CREDENTIALS_KEY] },
  });

  const configRow = rows.find((r) => r.key === CONFIG_KEY);
  if (!configRow || !configRow.value) {return null;}

  let config;
  try {
    config = JSON.parse(configRow.value);
  } catch {
    throw new AppError(500, "Stored storage configuration is corrupt");
  }

  // afterFind on TenantSettings has already decrypted this row.
  const credentialsRow = rows.find((r) => r.key === CREDENTIALS_KEY);
  if (credentialsRow && credentialsRow.value) {
    try {
      Object.assign(config, JSON.parse(credentialsRow.value));
    } catch {
      throw new AppError(500, "Stored storage credentials are corrupt");
    }
  }

  return config;
};

/**
 * Persist a tenant's storage override. Credentials are separated into the
 * KMS-encrypted row and never written into `storage_config`.
 */
const setTenantConfig = async (tenantId, input = {}) => {
  if (!tenantId) {
    throw new AppError(400, "A tenant is required to configure storage");
  }
  const config = validateTenantConfig(input);

  await TenantSettings.upsert({
    tenantId,
    key: CONFIG_KEY,
    value: JSON.stringify(config),
  });

  const credentials = {};
  if (input.accessKeyId) {credentials.accessKeyId = String(input.accessKeyId);}
  if (input.secretAccessKey) {
    credentials.secretAccessKey = String(input.secretAccessKey);
  }

  if (Object.keys(credentials).length > 0) {
    // upsert() bypasses the beforeSave hook that performs envelope encryption,
    // so build/save the instance explicitly — otherwise the secret lands in
    // the database in plaintext.
    const [row] = await TenantSettings.findOrBuild({
      where: { tenantId, key: CREDENTIALS_KEY },
      defaults: { tenantId, key: CREDENTIALS_KEY },
    });
    row.value = JSON.stringify(credentials);
    await row.save();
  }

  return config;
};

/** Remove a tenant's override so it falls back to the platform default. */
const clearTenantConfig = async (tenantId) => {
  if (!tenantId) {
    throw new AppError(400, "A tenant is required to clear storage settings");
  }
  const destroyed = await TenantSettings.destroy({
    where: { tenantId, key: [CONFIG_KEY, CREDENTIALS_KEY] },
  });
  return { cleared: destroyed };
};

module.exports = {
  PROVIDERS,
  CONFIG_KEY,
  CREDENTIALS_KEY,
  getGlobalConfig,
  getTenantConfig,
  setTenantConfig,
  clearTenantConfig,
  validateTenantConfig,
};
