/**
 * Storage key construction and validation.
 *
 * Every object lives under a key whose FIRST segments encode ownership:
 *
 *   t/<tenantId>/<domain>/<name>     tenant-owned
 *   global/<domain>/<name>           platform-owned
 *
 * This is the tenant-isolation boundary for storage, and it is enforced here
 * rather than in each driver: a driver only ever receives a key that has
 * already been proven to belong to the caller's tenant. The same
 * deny-by-default rule as utils/tenantScope.util.js applies — an operation
 * with no tenant context cannot reach tenant-owned keys at all.
 */

const { AppError } = require("../../utils/appError.util");

const TENANT_SEGMENT = "t";
const GLOBAL_SEGMENT = "global";

/**
 * Domains are an allowlist so a caller cannot invent a namespace that escapes
 * quota accounting or the retention/backup policies attached to each domain.
 */
const DOMAINS = Object.freeze([
  "attachments",
  "certificates",
  "avatars",
  "backups",
  "exports",
  "branding",
  "temp",
]);

// No slashes, no dots-only segments, no whitespace, no control characters.
// Deliberately stricter than any filesystem: keys are generated server-side
// from sanitized names, so anything outside this set is a bug or an attack.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isSafeSegment = (segment) =>
  SAFE_SEGMENT.test(segment) && segment !== "." && segment !== "..";

/** `t/<tenantId>/` — the prefix every key for this tenant must start with. */
const tenantPrefix = (tenantId) => `${TENANT_SEGMENT}/${tenantId}/`;

/** `global/` — platform-owned objects with no tenant. */
const globalPrefix = () => `${GLOBAL_SEGMENT}/`;

/**
 * Validate an untrusted key and return it normalized.
 * Throws rather than "cleaning up" a suspicious key: silently rewriting a
 * traversal attempt into a valid key is how one tenant ends up reading
 * another's object.
 */
const normalizeKey = (key) => {
  if (typeof key !== "string" || key.length === 0) {
    throw new AppError(400, "Invalid storage key");
  }
  if (key.length > 1024) {
    throw new AppError(400, "Storage key too long");
  }
  // Backslashes matter on Windows, where they are ALSO path separators — a key
  // containing one would traverse on the local driver but look inert here.
  if (key.includes("\\") || key.includes("\0")) {
    throw new AppError(400, "Invalid storage key");
  }

  const segments = key.split("/");
  if (segments.some((segment) => !isSafeSegment(segment))) {
    throw new AppError(400, "Invalid storage key");
  }

  return segments.join("/");
};

/**
 * Build a key for a tenant (or the platform when `tenantId` is null).
 * `name` must already be a server-generated, sanitized filename.
 */
const buildKey = ({ tenantId = null, domain, name }) => {
  if (!DOMAINS.includes(domain)) {
    throw new AppError(400, `Unknown storage domain: ${domain}`);
  }
  const prefix = tenantId
    ? tenantPrefix(normalizeKey(String(tenantId)))
    : globalPrefix();
  return normalizeKey(`${prefix}${domain}/${name}`);
};

/**
 * Gate every driver call: prove `key` belongs to `tenantId`.
 *
 * Deny-by-default — a null/absent tenantId may only touch `global/`. It never
 * grants access to the whole namespace.
 */
const assertKeyForTenant = (key, tenantId) => {
  const normalized = normalizeKey(key);
  const expected = tenantId ? tenantPrefix(String(tenantId)) : globalPrefix();

  if (!normalized.startsWith(expected)) {
    throw new AppError(403, "Storage key does not belong to this tenant");
  }
  return normalized;
};

/** Prefix to enumerate/delete everything a tenant owns (e.g. tenant deletion). */
const scopePrefix = (tenantId, domain = null) => {
  const base = tenantId ? tenantPrefix(String(tenantId)) : globalPrefix();
  if (!domain) {return normalizeKey(base.slice(0, -1)) + "/";}
  if (!DOMAINS.includes(domain)) {
    throw new AppError(400, `Unknown storage domain: ${domain}`);
  }
  return `${base}${domain}/`;
};

module.exports = {
  DOMAINS,
  buildKey,
  normalizeKey,
  assertKeyForTenant,
  tenantPrefix,
  globalPrefix,
  scopePrefix,
};
