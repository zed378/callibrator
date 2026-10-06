/**
 * U-06b (ADR-120) — a short cache of the dashboard's aggregates, per scope.
 *
 * WHY. `GET /dashboard/metrics` runs 21 aggregate statements (dashboard.service)
 * and cost 43.5 ms of backend CPU per call, about 40% of the U-06 load mix's
 * CPU on a single event loop (MEMORY/records/2026-10-05-u06-list-performance.md).
 * Its figures are counts over a tenant's whole inventory and history; a home
 * page that reloads them on every visit gains nothing from a fresher answer
 * than half a minute.
 *
 * WHAT.
 *  - The service's result is kept for DASHBOARD_CACHE_TTL_SECONDS (30 s), in
 *    Redis (`SETEX`), so every replica shares it. The staleness bound is the
 *    TTL: a write is visible on the dashboard at most 30 s later. Nothing
 *    invalidates on write (ADR-120 says why).
 *  - The KEY is the scope the figures were computed for, and the kind of
 *    caller that asked: `dashboard:metrics:v1:tenant:<callerTenantId>:<target>`
 *    for a tenant principal (target = its own tenant, always), and
 *    `dashboard:metrics:v1:platform:<target>` for the super admin (target = a
 *    tenant id or `global`). Two tenants never share a key, and a tenant never
 *    reads a value the platform view computed, or the other way round. The
 *    result does not vary by role inside a tenant (the gate is `home` read,
 *    which every role holds; the figures are the tenant's), so the role is not
 *    in the key. A target that is not a UUID is never cached: the call goes
 *    straight through (the key space stays bounded by real tenants).
 *  - If Redis is unavailable — not ready, or a command fails — the value is
 *    kept in a bounded in-process LRU with the same TTL instead. A cache
 *    failure never fails the request: the worst case is a recomputation.
 *  - Concurrent misses for one key in one process share one computation
 *    (single flight), so a TTL expiry under load does not start N copies of
 *    21 statements.
 *  - The payload carries `data.generatedAt` (the service sets it when it
 *    computes), so a cached answer says how old it is; the dashboard shows it.
 *
 * Named exports only.
 */
import redis from "./redis.service";
import { logger } from "../middlewares/activityLog.middleware";

/** How long a computed dashboard is served, in seconds: the staleness bound. */
export const DASHBOARD_CACHE_TTL_SECONDS = 30;

/** How many scopes the in-process fallback holds (oldest evicted first). */
export const DASHBOARD_LRU_MAX = 500;

const KEY_PREFIX = "dashboard:metrics:v1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who asked, as far as the key is concerned. */
export interface DashboardCaller {
  /** The platform super admin (global or any tenant's view). */
  readonly superAdmin: boolean;
  /** The caller's own tenant (`req.user.tenantId`). */
  readonly tenantId: string | null | undefined;
}

/**
 * The cache key for a caller asking for `target` (a tenant id, or null for
 * the global view), or null when the request must not be cached.
 */
export const dashboardCacheKey = (caller: DashboardCaller, target: string | null): string | null => {
  if (target !== null && !UUID_RE.test(target)) {
    return null;
  }
  if (caller.superAdmin) {
    return `${KEY_PREFIX}:platform:${target ?? "global"}`;
  }
  const own = caller.tenantId;
  // A tenant principal is always pinned to its own tenant (the controller);
  // anything else is not a shape this cache knows, so it is not cached.
  if (!own || !UUID_RE.test(own) || target !== own) {
    return null;
  }
  return `${KEY_PREFIX}:tenant:${own}:${target}`;
};

interface LruEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

/** The in-process fallback: insertion order is recency order (a Map re-set moves a key to the end). */
const lru = new Map<string, LruEntry>();

const lruGet = (key: string, now: number): unknown => {
  const entry = lru.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= now) {
    lru.delete(key);
    return undefined;
  }
  lru.delete(key);
  lru.set(key, entry);
  return entry.value;
};

const lruSet = (key: string, value: unknown, now: number): void => {
  lru.delete(key);
  lru.set(key, { value, expiresAt: now + DASHBOARD_CACHE_TTL_SECONDS * 1000 });
  while (lru.size > DASHBOARD_LRU_MAX) {
    const oldest = lru.keys().next().value as string;
    lru.delete(oldest);
  }
};

/** Computations in flight in this process, by key. */
const inFlight = new Map<string, Promise<unknown>>();

const readShared = async (key: string): Promise<unknown> => {
  try {
    return await redis.get(key);
  } catch (err) {
    // redis.get already answers null on its own failures; this guards a
    // replaced or mocked client too. A cache read never fails the request.
    logger.warn("dashboard cache: read failed; computing", { error: (err as Error).message });
    return null;
  }
};

const writeShared = async (key: string, value: unknown): Promise<boolean> => {
  try {
    return await redis.set(key, value, DASHBOARD_CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn("dashboard cache: write failed; keeping it in process", { error: (err as Error).message });
    return false;
  }
};

/**
 * The value cached under `key`, else `compute()`'s, stored for the TTL.
 * A null key computes without caching.
 */
export const cachedDashboard = async <T>(key: string | null, compute: () => Promise<T>): Promise<T> => {
  if (key === null) {
    return compute();
  }
  const shared = await readShared(key);
  if (shared !== null && shared !== undefined) {
    return shared as T;
  }
  const local = lruGet(key, Date.now());
  if (local !== undefined) {
    return local as T;
  }
  const running = inFlight.get(key);
  if (running) {
    return running as Promise<T>;
  }
  const work = (async (): Promise<T> => {
    try {
      const value = await compute();
      if (!(await writeShared(key, value))) {
        lruSet(key, value, Date.now());
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, work);
  return work;
};

/** Empties the in-process fallback (tests; never needed in operation, the TTL bounds it). */
export const clearDashboardCache = (): void => {
  lru.clear();
  inFlight.clear();
};
