/**
 * Storage façade — the only thing application code should import.
 *
 *   const storage = await getTenantStorage(tenantId);
 *   const key = storage.buildKey({ domain: "attachments", name: fileName });
 *   await storage.put(key, buffer, { contentType });
 *
 * Two guarantees this layer provides that a raw driver does not:
 *
 * 1. **Tenant binding.** Every call runs through assertKeyForTenant, so a bug
 *    in a service cannot address another tenant's object even if it constructs
 *    the key by hand. Deny-by-default: no tenant means `global/` only.
 * 2. **Provider resolution.** Tenant-configured provider first, platform
 *    default second — resolved once and cached per tenant.
 *
 * A-40 — the cache is per process, so invalidation must reach every replica.
 * A settings change bumps a per-tenant GENERATION in Redis; every resolve
 * compares the cached driver's generation with Redis's and rebuilds on a
 * mismatch, so a rotated or revoked credential stops being used on every
 * replica on its next request, not at its next restart. When Redis is
 * unavailable the generation reads as null everywhere, and staleness is
 * bounded instead by a local TTL (STORAGE_DRIVER_CACHE_TTL_SEC, default 60s).
 *
 * P9-18 (ADR-087, Stage C): converted from index.js with no behaviour change,
 * under the four isolation gates. `export =` keeps the object `require()`
 * returned (the same keys, in the same order, `ScopedStorage` included). The
 * drivers, `keys`, `config`, `signing`, `crypto`, `redisService` and
 * `AppError` are captured at load, as the `.js` required them. The signing
 * secret is still read once at load; the TTL and PUBLIC_BASE_URL at each
 * call, now through config/env.
 */

import type { Readable } from "stream";
import LocalDriver from "./local.driver";
import S3Driver from "./s3.driver";
import keys from "./keys";
import config from "./config.service";
import signing from "./signing";
import crypto from "crypto";
import redisService from "../redis.service";
import { AppError as LoadedAppError } from "../../utils/appError.util";
import { env } from "../../config/env";

const AppError = LoadedAppError;

/** An inclusive byte range. */
interface ByteRange {
  start: number;
  end: number;
}

/** What ScopedStorage calls on a driver (LocalDriver and S3Driver both provide it). */
interface StorageDriver {
  name: string;
  put(key: string, body: Buffer | Readable, options?: { contentType?: string | null }): Promise<unknown>;
  get(key: string, range?: ByteRange | null): Promise<unknown>;
  stat(key: string): Promise<{ size: number | null }>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<unknown>;
  list(prefix: string | null, options?: { limit?: number; cursor?: string | null }): Promise<{ keys: string[]; cursor?: string | null }>;
  deleteMany(prefix: string | null): Promise<unknown>;
  signedUrl(key: string, options?: Record<string, unknown>): unknown;
  healthCheck(): Promise<{ ok: boolean; error?: string | undefined }>;
}

/** A resolved configuration, as config.service answers it (credentials re-attached for a tenant). */
type ResolvedConfig = { provider: string } & Record<string, unknown>;

/* istanbul ignore next -- env-selected secret: which side of the `||` wins
   depends on deployment env, so both branches aren't exercised under the fixed
   test env. */
const SIGN_SECRET =
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty secret also falls back
  env("ATTACHMENT_URL_SECRET") || env("CERT_SIGNING_SECRET");

// tenantId (or "__global__") -> { driver, generation, builtAt }. Drivers hold
// an S3 client and a connection pool, so rebuilding one per request would be
// wasteful.
const driverCache = new Map<string, { driver: StorageDriver; generation: string | null; builtAt: number }>();
const GLOBAL_CACHE_KEY = "__global__";

/** Redis key holding a tenant's driver generation (A-40). */
const GENERATION_PREFIX = "storage:driver-generation:";
/** Lifetime of a generation marker; its expiry only costs one rebuild. */
const GENERATION_TTL_SEC = 30 * 24 * 60 * 60;
/** Upper bound on a cached driver's age — the fallback when Redis is down. */
const localTtlMs = (): number => (Number(env("STORAGE_DRIVER_CACHE_TTL_SEC")) || 60) * 1000;

/** The shared generation for a cache key, or null (unset / Redis down). */
const currentGeneration = async (cacheKey: string): Promise<string | null> => {
  const generation = await redisService.get(GENERATION_PREFIX + cacheKey);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the stored marker's string form
  return generation === null || generation === undefined ? null : String(generation);
};

/** Instantiate the driver described by a resolved configuration. */
const buildDriver = (resolved: ResolvedConfig): StorageDriver => {
  switch (resolved.provider) {
    case "s3":
      return new S3Driver(resolved as ConstructorParameters<typeof S3Driver>[0]);
    case "nfs":
      return new LocalDriver({ ...resolved, name: "nfs" });
    case "local":
      return new LocalDriver({ ...resolved, name: "local" });
    /* istanbul ignore next -- unreachable: both config paths validate the
       provider against the same allowlist before it reaches here. */
    default:
      throw new AppError(500, `Unsupported storage provider: ${resolved.provider}`);
  }
};

/**
 * A driver bound to one tenant. Every method asserts the key belongs to that
 * tenant before it reaches the driver.
 */
class ScopedStorage {
  driver: StorageDriver;
  tenantId: string | null;
  provider: string;

  constructor(driver: StorageDriver, tenantId: string | null | undefined) {
    this.driver = driver;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as no tenant
    this.tenantId = tenantId || null;
    this.provider = driver.name;
  }

  /** Build a key inside this tenant's namespace. */
  buildKey({ domain, name }: { domain: string; name: string }): string {
    return keys.buildKey({ tenantId: this.tenantId, domain, name });
  }

  _guard(key: unknown): string {
    return keys.assertKeyForTenant(key, this.tenantId);
  }

  put(key: unknown, body: Buffer | Readable, options?: { contentType?: string | null }): Promise<unknown> {
    return this.driver.put(this._guard(key), body, options);
  }

  /** @param range - inclusive byte range */
  get(key: unknown, range?: ByteRange | null): Promise<unknown> {
    return this.driver.get(this._guard(key), range);
  }

  stat(key: unknown): Promise<{ size: number | null }> {
    return this.driver.stat(this._guard(key));
  }

  exists(key: unknown): Promise<boolean> {
    return this.driver.exists(this._guard(key));
  }

  delete(key: unknown): Promise<unknown> {
    return this.driver.delete(this._guard(key));
  }

  /** List within a domain (or the whole tenant namespace when omitted). */
  list(domain: string | null = null, options?: { limit?: number; cursor?: string | null }): Promise<{ keys: string[] }> {
    return this.driver.list(keys.scopePrefix(this.tenantId, domain), options);
  }

  /** Delete a whole domain, or everything this tenant owns. */
  deleteMany(domain: string | null = null): Promise<unknown> {
    return this.driver.deleteMany(keys.scopePrefix(this.tenantId, domain));
  }

  /**
   * A time-limited download URL. On S3 this is a presigned URL the client
   * fetches directly (`direct: true`), which keeps download traffic off the
   * app server; on local/NFS it is an HMAC-signed app route.
   */
  signedUrl(key: unknown, options: Record<string, unknown> & { baseUrl?: string | null } = {}): unknown {
    const guarded = this._guard(key);
    if (this.driver.name === "s3") {
      return this.driver.signedUrl(guarded, options);
    }
    return this.driver.signedUrl(guarded, {
      ...options,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: empty values also fall back
      baseUrl: options.baseUrl || env("PUBLIC_BASE_URL") || "",
      secret: SIGN_SECRET,
    });
  }

  /** Total bytes this tenant is storing — the input to quota + metering. */
  async usage(domain: string | null = null): Promise<{ bytes: number; objects: number }> {
    // U-09: every page. S3 returns at most 1000 keys a page with a cursor for
    // the rest; reading only the first page counted a tenant's first 1000
    // objects. The local/NFS driver returns everything and no cursor.
    const prefix = keys.scopePrefix(this.tenantId, domain);
    const objectKeys: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await this.driver.list(prefix, {
        limit: Number.MAX_SAFE_INTEGER,
        ...(cursor ? { cursor } : {}),
      });
      objectKeys.push(...page.keys);
      cursor = page.cursor;
    } while (cursor);
    let bytes = 0;
    for (const key of objectKeys) {
      // A key can disappear mid-enumeration (concurrent delete); it simply
      // contributes nothing rather than failing the whole calculation.
      try {
        const s = await this.driver.stat(key);
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
        bytes += s.size || 0;
      } catch (err) {
        const { status } = err as { status?: unknown };
        if (status !== 404 && status !== 410) {throw err;}
      }
    }
    return { bytes, objects: objectKeys.length };
  }

  healthCheck(): Promise<{ ok: boolean; error?: string | undefined }> {
    return this.driver.healthCheck();
  }
}

/** Resolve the driver for a tenant: tenant override first, platform default. */
const resolveDriver = async (tenantId: string | null): Promise<StorageDriver> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as global
  const cacheKey = tenantId || GLOBAL_CACHE_KEY;
  const generation = await currentGeneration(cacheKey);
  const cached = driverCache.get(cacheKey);
  if (
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
    cached &&
    cached.generation === generation &&
    Date.now() - cached.builtAt < localTtlMs()
  ) {
    return cached.driver;
  }

  // As built: the tenant id is passed as given.
  const tenantConfig = (tenantId ? await config.getTenantConfig(tenantId as Parameters<typeof config.getTenantConfig>[0]) : null) as
    | (Record<string, unknown> & { accessKeyId?: unknown; secretAccessKey?: unknown })
    | null;

  // Re-validate on read, not just on write: a stored configuration could
  // predate a validation rule, or have been edited out of band.
  const driver = tenantConfig
    ? buildDriver({
      // validateTenantConfig returns only the non-secret shape, so the
      // credentials are re-attached here for the driver.
      ...config.validateTenantConfig(tenantConfig),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty credential reads as none
      accessKeyId: tenantConfig.accessKeyId || null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty credential reads as none
      secretAccessKey: tenantConfig.secretAccessKey || null,
    })
    : buildDriver(config.getGlobalConfig());

  driverCache.set(cacheKey, { driver, generation, builtAt: Date.now() });
  return driver;
};

/**
 * Build a driver from a candidate configuration WITHOUT caching it. Used to
 * health-check settings before they are saved — a probe must never become the
 * live driver, and must never displace the cached one.
 */
const buildProbeDriver = (resolved: ResolvedConfig): StorageDriver => buildDriver(resolved);

/** Storage bound to a tenant. */
const getTenantStorage = async (tenantId: string | null | undefined): Promise<ScopedStorage> => {
  if (!tenantId) {
    throw new AppError(500, "getTenantStorage requires a tenantId");
  }
  return new ScopedStorage(await resolveDriver(tenantId), tenantId);
};

/** Platform-owned storage (`global/` keys only) — never tenant data. */
const getGlobalStorage = async (): Promise<ScopedStorage> =>
  new ScopedStorage(await resolveDriver(null), null);

/**
 * Resolve a local/NFS signed-object download from a `key` + HMAC `token`.
 *
 * The key itself carries the owner (`t/<tenantId>/...` or `global/...`), so the
 * tenant is derived from the key and never trusted from the request — a valid
 * token for tenant A's key can only ever open tenant A's object.
 *
 * Returns the object's metadata and an `open(range?)` that yields a readable
 * stream — split so the route can answer 304/416/HEAD from the metadata
 * without ever opening the object, and open only the byte range asked for
 * (ADR-042 step 5). Throws 403 on a bad/expired token BEFORE touching storage.
 */
const openSignedObject = async (
  rawKey: unknown,
  token: unknown,
): Promise<{ meta: { size: number | null }; open: (range?: ByteRange | null) => Promise<unknown> }> => {
  const key = keys.normalizeKey(rawKey);
  if (!signing.verify(key, token, SIGN_SECRET)) {
    throw new AppError(403, "Invalid or expired download link");
  }

  // Owner is the tenant segment of the key; global objects have none.
  const tenantId = key.startsWith("t/") ? key.split("/")[1] : null;
  const scoped = tenantId
    ? await getTenantStorage(tenantId)
    : await getGlobalStorage();

  const meta = await scoped.stat(key);
  return { meta, open: (range) => scoped.get(key, range) };
};

/**
 * Drop a cached driver after its configuration changes — here, and (A-40) on
 * every other replica, by bumping the shared generation they compare against.
 *
 * @returns whether the generation reached Redis; false
 *   means other replicas converge only when their local TTL expires
 */
const invalidate = async (tenantId: string | null | undefined): Promise<boolean> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as global
  const cacheKey = tenantId || GLOBAL_CACHE_KEY;
  driverCache.delete(cacheKey);
  return redisService.set(
    GENERATION_PREFIX + cacheKey,
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
    `${Date.now()}-${crypto.randomUUID()}`,
    GENERATION_TTL_SEC,
  );
};

/** Drop every cached driver (config reload / tests). */
const invalidateAll = (): void => {
  driverCache.clear();
};

export = {
  getTenantStorage,
  getGlobalStorage,
  buildProbeDriver,
  openSignedObject,
  invalidate,
  invalidateAll,
  ScopedStorage,
  DOMAINS: keys.DOMAINS,
  keys,
  config,
  signing,
};
