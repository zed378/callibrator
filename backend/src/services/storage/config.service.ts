/**
 * Storage configuration: the platform default, and each tenant's own override.
 *
 * P9-18 (ADR-087, Stage C leaves): converted from storage/config.service.js
 * with no behaviour change. `export =` keeps the exact object `require()`
 * returned (the same keys, in the same order). `TenantSettings`, `AppError`
 * and `storagePath` are captured once at load, as the `.js` did. Environment
 * reads go through src/config/env (P9-06) at call time; `||` stays wherever
 * the `.js` had it, because an empty variable has always meant "unset".
 *
 * This is the cost lever behind the whole storage module: a tenant that brings
 * its own bucket pays its own storage bill; a tenant that does not falls back to
 * the shared platform bucket.
 *
 * A tenant's own bucket does NOT lift its `limitStorageMb` today (ADR-084,
 * Q-06). The quota bounds what the platform holds, and the attachment upload
 * path still writes every file to platform storage — it was never cut over to
 * this module (docs/STORAGE/04). The exemption applies per attachment once its
 * bytes live only in the tenant's storage; see quota.service.js.
 *
 *   1. tenant-configured provider  (TenantSettings, credentials KMS-encrypted)
 *   2. global default provider     (environment)
 *
 * Non-secret settings live in `storage_config`; credentials live in
 * `storage_credentials`, which the TenantSettings model envelope-encrypts.
 */

import type { Transaction } from "sequelize";
import models from "../../models";
import { db } from "../../config";
import auditService from "../audit.service";
import { actorChanges, auditEntryActor } from "../../utils/auditPrincipal.util";
import type { AuditActorInput } from "../../utils/auditPrincipal.util";
import { AppError as LoadedAppError } from "../../utils/appError.util";
import loadedStoragePath from "../../utils/storagePath.util";
import { env, envOr } from "../../config/env";
import type { TenantId } from "../../types/ids";

const { TenantSettings } = models;
const AppError = LoadedAppError;
const storagePath = loadedStoragePath;

/** The platform default, from the environment. */
type GlobalStorageConfig =
  | {
      provider: "s3";
      bucket: string;
      region: string;
      endpoint: string | null;
      endpointTrusted: true;
      forcePathStyle: boolean;
      prefix: string | null;
      accessKeyId: string | null;
      secretAccessKey: string | null;
    }
  | { provider: "nfs"; root: string; fsync: boolean }
  | { provider: "local"; root: string; fsync: false };

/** A tenant-supplied configuration, validated (credentials are not part of it). */
type TenantStorageConfig =
  | {
      provider: string;
      bucket: string;
      region: string;
      endpoint: string | null;
      forcePathStyle: boolean;
      prefix: string | null;
    }
  | { provider: string; root: string; fsync: boolean };

/** What a caller may pass: any values, validated here. */
interface StorageConfigInput {
  provider?: unknown;
  bucket?: unknown;
  region?: unknown;
  endpoint?: unknown;
  forcePathStyle?: unknown;
  prefix?: unknown;
  root?: unknown;
  fsync?: unknown;
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
}

const CONFIG_KEY = "storage_config";
const CREDENTIALS_KEY = "storage_credentials";

const PROVIDERS: readonly string[] = Object.freeze(["local", "s3", "nfs"]);

/** Read the platform-wide default from the environment. */
const getGlobalConfig = (): GlobalStorageConfig => {
  const provider = envOr("STORAGE_DRIVER", "local").toLowerCase();

  if (!PROVIDERS.includes(provider)) {
    throw new AppError(
      500,
      `Invalid STORAGE_DRIVER "${provider}" (expected: ${PROVIDERS.join(", ")})`,
    );
  }

  if (provider === "s3") {
    const bucket = env("STORAGE_S3_BUCKET");
    if (!bucket) {
      throw new AppError(500, "STORAGE_DRIVER=s3 requires STORAGE_S3_BUCKET");
    }
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable means "unset" */
    return {
      provider: "s3",
      bucket,
      region: env("STORAGE_S3_REGION") || "us-east-1",
      endpoint: env("STORAGE_S3_ENDPOINT") || null,
      // Operator-configured, therefore exempt from the SSRF guard: a MinIO
      // sidecar or in-cluster gateway is legitimately an internal address.
      // Tenant-supplied endpoints never get this flag.
      endpointTrusted: true,
      forcePathStyle: env("STORAGE_S3_FORCE_PATH_STYLE") !== "false",
      prefix: env("STORAGE_S3_PREFIX") || null,
      // Absent credentials means the SDK's ambient chain (IAM role), which is
      // the right setup for a platform-owned bucket.
      accessKeyId: env("STORAGE_S3_ACCESS_KEY_ID") || null,
      secretAccessKey: env("STORAGE_S3_SECRET_ACCESS_KEY") || null,
    };
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  }

  if (provider === "nfs") {
    const root = env("STORAGE_NFS_ROOT");
    if (!root) {
      throw new AppError(500, "STORAGE_DRIVER=nfs requires STORAGE_NFS_ROOT");
    }
    return {
      provider: "nfs",
      root,
      // Default ON: an NFS client can otherwise acknowledge a write that is
      // still only in its own page cache.
      fsync: env("STORAGE_NFS_FSYNC") !== "false",
    };
  }

  return {
    provider: "local",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable means "unset", and storagePath() is only called when it is
    root: env("STORAGE_LOCAL_ROOT") || storagePath("storage"),
    fsync: false,
  };
};

/* eslint-disable @typescript-eslint/no-base-to-string -- as built: String() of a caller-supplied value, whatever its type, exactly as the `.js` did */
/** Validate a tenant-supplied configuration before it is persisted or used. */
const validateTenantConfig = (config: unknown): TenantStorageConfig => {
  if (!config || typeof config !== "object") {
    throw new AppError(400, "Storage configuration is required");
  }
  const input = config as StorageConfigInput;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy provider reads as ""
  const provider = String(input.provider || "").toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new AppError(
      400,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the caller's value is interpolated as given (a template, not String(), so a Symbol still throws a TypeError here)
      `Invalid storage provider "${input.provider}" (expected: ${PROVIDERS.join(", ")})`,
    );
  }

  if (provider === "s3") {
    if (!input.bucket) {
      throw new AppError(400, "S3 storage requires a bucket");
    }
    return {
      provider,
      bucket: String(input.bucket),
      region: input.region ? String(input.region) : "us-east-1",
      endpoint: input.endpoint ? String(input.endpoint) : null,
      forcePathStyle: input.forcePathStyle !== false,
      prefix: input.prefix ? String(input.prefix) : null,
    };
  }

  if (provider === "nfs") {
    if (!input.root) {
      throw new AppError(400, "NFS storage requires a mount root");
    }
    return {
      provider,
      root: String(input.root),
      fsync: input.fsync !== false,
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
/* eslint-enable @typescript-eslint/no-base-to-string */

/**
 * Read a tenant's storage override, or null when it uses the platform default.
 * The stored JSON is returned as parsed, with the decrypted credentials merged
 * in; its shape is whatever was persisted.
 */
const getTenantConfig = async (tenantId: TenantId | null | undefined): Promise<unknown> => {
  if (!tenantId) {return null;}

  const rows = await TenantSettings.findAll({
    where: { tenantId, key: [CONFIG_KEY, CREDENTIALS_KEY] },
    // skipFacilityScope: the tenant's storage driver for a bound user's own upload or download
    // (A-5 / A-6); never returned to the caller (P18-03 § 10.2).
    skipFacilityScope: true,
  });

  const configRow = rows.find((r) => r.key === CONFIG_KEY);
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!configRow || !configRow.value`
  if (!configRow || !configRow.value) {return null;}

  let config: unknown;
  try {
    config = JSON.parse(configRow.value);
  } catch {
    throw new AppError(500, "Stored storage configuration is corrupt");
  }

  // afterFind on TenantSettings has already decrypted this row.
  const credentialsRow = rows.find((r) => r.key === CREDENTIALS_KEY);
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `credentialsRow && credentialsRow.value`
  if (credentialsRow && credentialsRow.value) {
    try {
      // As built: `config` is whatever the stored JSON held; Object.assign
      // throws (caught below) on null, and boxes any other primitive.
      Object.assign(config as object, JSON.parse(credentialsRow.value));
    } catch {
      throw new AppError(500, "Stored storage credentials are corrupt");
    }
  }

  return config;
};

/**
 * P6-11 (2026-09-30) — a storage change commits with one audit row in its
 * transaction. It records WHICH settings changed and their non-secret values
 * (`storage_config` holds none: credentials live in their own KMS-encrypted
 * row), and only THAT credentials were set — never a key or a secret.
 *
 * @param transaction - the change's transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId - the tenant whose storage changed
 * @param changes - { operation, before, after, credentialsSet? }
 */
const auditStorageChange = (
  transaction: Transaction,
  actor: AuditActorInput | null | undefined,
  tenantId: TenantId,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action: "UPDATE",
      resourceType: "TenantStorageConfig",
      resourceId: tenantId,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** The stored (secret-free) override, parsed, or null — read inside the change's transaction. */
const storedConfig = async (tenantId: TenantId, transaction: Transaction): Promise<unknown> => {
  const row = await TenantSettings.findOne({ where: { tenantId, key: CONFIG_KEY }, transaction });
  if (!row?.value) {return null;}
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return "(unparseable)";
  }
};

/** The keys whose values differ between two configs (either may be null). */
const changedKeys = (before: unknown, after: unknown): string[] => {
  const a = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const b = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
};

/**
 * Persist a tenant's storage override. Credentials are separated into the
 * KMS-encrypted row and never written into `storage_config`.
 */
const setTenantConfig = async (
  tenantId: TenantId | null | undefined,
  input: StorageConfigInput = {},
  actor: AuditActorInput | null = null,
): Promise<TenantStorageConfig> => {
  if (!tenantId) {
    throw new AppError(400, "A tenant is required to configure storage");
  }
  const config = validateTenantConfig(input);

  // P6-11: the override, the credentials row and the audit row commit together.
  // row.save() below joins this transaction through CLS (config/index.js).
  await db.transaction(async (transaction: Transaction) => {
    const before = await storedConfig(tenantId, transaction);
    await TenantSettings.upsert(
      {
        tenantId,
        key: CONFIG_KEY,
        value: JSON.stringify(config),
      },
      { transaction },
    );

    const credentials: { accessKeyId?: string; secretAccessKey?: string } = {};
    /* eslint-disable @typescript-eslint/no-base-to-string -- as built: String() of a caller-supplied value */
    if (input.accessKeyId) {credentials.accessKeyId = String(input.accessKeyId);}
    if (input.secretAccessKey) {
      credentials.secretAccessKey = String(input.secretAccessKey);
    }
    /* eslint-enable @typescript-eslint/no-base-to-string */

    if (Object.keys(credentials).length > 0) {
      // upsert() bypasses the beforeSave hook that performs envelope encryption,
      // so build/save the instance explicitly — otherwise the secret lands in
      // the database in plaintext.
      const [row] = await TenantSettings.findOrBuild({
        where: { tenantId, key: CREDENTIALS_KEY },
        defaults: { tenantId, key: CREDENTIALS_KEY },
        transaction,
      });
      row.value = JSON.stringify(credentials);
      await row.save({ transaction });
    }

    await auditStorageChange(transaction, actor, tenantId, {
      operation: "STORAGE_CONFIG_SET",
      changed: changedKeys(before, config),
      before,
      after: config,
      // Which credential fields were supplied — never their values.
      credentialsSet: Object.keys(credentials).sort(),
    });
  });

  return config;
};

/** Remove a tenant's override so it falls back to the platform default. */
const clearTenantConfig = async (
  tenantId: TenantId | null | undefined,
  actor: AuditActorInput | null = null,
): Promise<{ cleared: number }> => {
  if (!tenantId) {
    throw new AppError(400, "A tenant is required to clear storage settings");
  }
  const destroyed = await db.transaction(async (transaction: Transaction) => {
    const before = await storedConfig(tenantId, transaction);
    const count = await TenantSettings.destroy({
      where: { tenantId, key: [CONFIG_KEY, CREDENTIALS_KEY] },
      transaction,
    });
    // Clearing an override that does not exist changes nothing and writes no row.
    if (count > 0) {
      await auditStorageChange(transaction, actor, tenantId, {
        operation: "STORAGE_CONFIG_CLEAR",
        changed: changedKeys(before, null),
        before,
        after: null,
      });
    }
    return count;
  });
  return { cleared: destroyed };
};

export = {
  PROVIDERS,
  CONFIG_KEY,
  CREDENTIALS_KEY,
  getGlobalConfig,
  getTenantConfig,
  setTenantConfig,
  clearTenantConfig,
  validateTenantConfig,
};
