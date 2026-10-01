/**
 * Types for `src/services/redis.service.js`, which is still JavaScript (it
 * converts in P9-18). Written for P9-12 (ADR-087 Amendment 13), following the
 * `config/index.d.ts` precedent: the release build compiles with
 * `allowJs: false`, so a `.ts` module cannot import a `.js` one without
 * declared types. TypeScript resolves `./redis.service` to this file; Node
 * resolves it to `redis.service.js`. This file emits nothing and is never
 * copied into `dist/`.
 *
 * It declares exactly what redis.service.js exports (`module.exports = {...}`),
 * typed from its code. It is deleted when redis.service.js converts; until
 * then a change to that module's exports must change this file too.
 */
import type { Redis } from "ioredis";

declare const redisService: {
  /** `{ password?, username? }` from REDIS_PASSWORD / REDIS_USERNAME. */
  credentialOptions: () => { password?: string; username?: string };
  /** Connects the shared client; resolves with it when ready, or null when Redis is unavailable. */
  initRedis: () => Promise<Redis | null>;
  /** The shared client, created on first use. */
  getRedisConnection: () => Redis;
  /** The cached value, JSON-parsed (else the raw string); null on a miss or when Redis is unavailable. */
  get: (key: string) => Promise<unknown>;
  /** Stores `value` (JSON unless a string) for `ttl` seconds (default 300); false when Redis is unavailable. */
  set: (key: string, value: unknown, ttl?: number) => Promise<boolean>;
  /** Deletes one key; false when Redis is unavailable. */
  del: (key: string) => Promise<boolean>;
  /** Reads and deletes one key atomically (GETDEL); null on a miss or when Redis is unavailable. */
  getDel: (key: string) => Promise<unknown>;
  /** Deletes every key matching `pattern`; resolves with how many (0 when Redis is unavailable). */
  delPattern: (pattern: string) => Promise<number>;
  /** A lock id when acquired, else null. */
  acquireLock: (key: string, ttl?: number) => Promise<string | null>;
  /** Whether the lock held under `lockId` was released. */
  releaseLock: (key: string, lockId: string) => Promise<boolean>;
  /** Cache key builders. */
  cacheKeys: {
    user: (userId: unknown) => string;
    userByEmail: (email: unknown) => string;
    userByUsername: (username: unknown) => string;
    tenant: (tenantId: unknown) => string;
    tenantByCode: (code: unknown) => string;
    tenantSettings: (tenantId: unknown) => string;
    role: (roleId: unknown) => string;
    permissions: (roleId: unknown) => string;
    userPermissions: (userId: unknown) => string;
    session: (sessionHash: unknown) => string;
    rateLimit: (identifier: unknown) => string;
    lock: (resource: unknown) => string;
  };
  /** Closes the shared client on purpose (no reconnect). */
  closeRedis: () => Promise<void>;
  /** ioredis's retry delay for attempt `times`, capped at RETRY_DELAY_CAP_MS. */
  retryStrategy: (times: number) => number;
  RETRY_DELAY_CAP_MS: number;
};

export = redisService;
