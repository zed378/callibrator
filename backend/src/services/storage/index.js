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
 */

const LocalDriver = require("./local.driver");
const S3Driver = require("./s3.driver");
const keys = require("./keys");
const config = require("./config.service");
const signing = require("./signing");
const { AppError } = require("../../utils/appError.util");

/* istanbul ignore next -- env-selected secret: which side of the `||` wins
   depends on deployment env, so both branches aren't exercised under the fixed
   test env. */
const SIGN_SECRET =
  process.env.ATTACHMENT_URL_SECRET || process.env.CERT_SIGNING_SECRET;

// tenantId (or "__global__") -> driver instance. Drivers hold an S3 client and
// a connection pool, so rebuilding one per request would be wasteful.
const driverCache = new Map();
const GLOBAL_CACHE_KEY = "__global__";

/** Instantiate the driver described by a resolved configuration. */
const buildDriver = (resolved) => {
  switch (resolved.provider) {
    case "s3":
      return new S3Driver(resolved);
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
  constructor(driver, tenantId) {
    this.driver = driver;
    this.tenantId = tenantId || null;
    this.provider = driver.name;
  }

  /** Build a key inside this tenant's namespace. */
  buildKey({ domain, name }) {
    return keys.buildKey({ tenantId: this.tenantId, domain, name });
  }

  _guard(key) {
    return keys.assertKeyForTenant(key, this.tenantId);
  }

  put(key, body, options) {
    return this.driver.put(this._guard(key), body, options);
  }

  get(key) {
    return this.driver.get(this._guard(key));
  }

  stat(key) {
    return this.driver.stat(this._guard(key));
  }

  exists(key) {
    return this.driver.exists(this._guard(key));
  }

  delete(key) {
    return this.driver.delete(this._guard(key));
  }

  /** List within a domain (or the whole tenant namespace when omitted). */
  list(domain = null, options) {
    return this.driver.list(keys.scopePrefix(this.tenantId, domain), options);
  }

  /** Delete a whole domain, or everything this tenant owns. */
  deleteMany(domain = null) {
    return this.driver.deleteMany(keys.scopePrefix(this.tenantId, domain));
  }

  /**
   * A time-limited download URL. On S3 this is a presigned URL the client
   * fetches directly (`direct: true`), which keeps download traffic off the
   * app server; on local/NFS it is an HMAC-signed app route.
   */
  signedUrl(key, options = {}) {
    const guarded = this._guard(key);
    if (this.driver.name === "s3") {
      return this.driver.signedUrl(guarded, options);
    }
    return this.driver.signedUrl(guarded, {
      ...options,
      baseUrl: options.baseUrl || process.env.PUBLIC_BASE_URL || "",
      secret: SIGN_SECRET,
    });
  }

  /** Total bytes this tenant is storing — the input to quota + metering. */
  async usage(domain = null) {
    const { keys: objectKeys } = await this.driver.list(
      keys.scopePrefix(this.tenantId, domain),
      { limit: Number.MAX_SAFE_INTEGER },
    );
    let bytes = 0;
    for (const key of objectKeys) {
      // A key can disappear mid-enumeration (concurrent delete); it simply
      // contributes nothing rather than failing the whole calculation.
      try {
        const s = await this.driver.stat(key);
        bytes += s.size || 0;
      } catch (err) {
        if (err.status !== 404 && err.status !== 410) {throw err;}
      }
    }
    return { bytes, objects: objectKeys.length };
  }

  healthCheck() {
    return this.driver.healthCheck();
  }
}

/** Resolve the driver for a tenant: tenant override first, platform default. */
const resolveDriver = async (tenantId) => {
  const cacheKey = tenantId || GLOBAL_CACHE_KEY;
  if (driverCache.has(cacheKey)) {return driverCache.get(cacheKey);}

  const tenantConfig = tenantId ? await config.getTenantConfig(tenantId) : null;

  // Re-validate on read, not just on write: a stored configuration could
  // predate a validation rule, or have been edited out of band.
  const driver = tenantConfig
    ? buildDriver({
      // validateTenantConfig returns only the non-secret shape, so the
      // credentials are re-attached here for the driver.
      ...config.validateTenantConfig(tenantConfig),
      accessKeyId: tenantConfig.accessKeyId || null,
      secretAccessKey: tenantConfig.secretAccessKey || null,
    })
    : buildDriver(config.getGlobalConfig());

  driverCache.set(cacheKey, driver);
  return driver;
};

/**
 * Build a driver from a candidate configuration WITHOUT caching it. Used to
 * health-check settings before they are saved — a probe must never become the
 * live driver, and must never displace the cached one.
 */
const buildProbeDriver = (resolved) => buildDriver(resolved);

/** Storage bound to a tenant. */
const getTenantStorage = async (tenantId) => {
  if (!tenantId) {
    throw new AppError(500, "getTenantStorage requires a tenantId");
  }
  return new ScopedStorage(await resolveDriver(tenantId), tenantId);
};

/** Platform-owned storage (`global/` keys only) — never tenant data. */
const getGlobalStorage = async () =>
  new ScopedStorage(await resolveDriver(null), null);

/**
 * Resolve a local/NFS signed-object download from a `key` + HMAC `token`.
 *
 * The key itself carries the owner (`t/<tenantId>/...` or `global/...`), so the
 * tenant is derived from the key and never trusted from the request — a valid
 * token for tenant A's key can only ever open tenant A's object.
 *
 * Returns a readable stream plus the object's metadata for the response
 * headers. Throws 403 on a bad/expired token BEFORE touching storage.
 */
const openSignedObject = async (rawKey, token) => {
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
  const stream = await scoped.get(key);
  return { stream, meta };
};

/** Drop a cached driver after its configuration changes. */
const invalidate = (tenantId) => {
  driverCache.delete(tenantId || GLOBAL_CACHE_KEY);
};

/** Drop every cached driver (config reload / tests). */
const invalidateAll = () => {
  driverCache.clear();
};

module.exports = {
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
