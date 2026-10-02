/**
 * Redis-Backed Rate Limiter Service
 *
 * Single canonical rate limiter for the application.
 * Supports both auth brute-force protection (with lockout) and API request quotas.
 *
 * Storage is the SHARED ioredis client from `redis.service` whenever it is
 * ready; the in-process Map is a fallback for a Redis outage only. Read the
 * fallback-policy note below before changing either arm.
 *
 * P9-18 (ADR-087): converted from rateLimiter.redis.service.js (the ADR-100
 * Amendment 5 fixed-window version, the security lane's, as the baseline),
 * behaviour unchanged; its interim `.d.ts` is deleted with it. `crypto` is the
 * module object; what the JavaScript destructured at load is captured at load
 * (A-340 removed the two functions that required `Sessions` lazily); the environment is read
 * through config/env at the same moments. `export =` keeps the object
 * `require()` returned (the same keys, in the same order).
 */

import crypto from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Redis } from "ioredis";
import type { Attributes, UpdateOptions } from "sequelize";
import type { ModelInstance } from "../types/models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { getRedisConnection as loadedGetRedisConnection } from "./redis.service";
import {
  AUTH_ENDPOINTS as LOADED_AUTH_ENDPOINTS,
  API_ENDPOINTS as LOADED_API_ENDPOINTS,
  getAuthConfig as loadedGetAuthConfig,
  getApiConfig as loadedGetApiConfig,
  makeKey as loadedMakeKey,
} from "../constants/rateLimitConstants";
import { hashToken as loadedHashToken } from "../utils/session.util";
import { verifyAccessToken as loadedVerifyAccessToken, verifyPurposeToken as loadedVerifyPurposeToken } from "../utils/jwt.util";
import models from "../models";
import { recordAccountLock as loadedRecordAccountLock } from "./audit.service";
import { env } from "../config/env";

const logger = loadedLogger;
const getRedisConnection = loadedGetRedisConnection;
const AUTH_ENDPOINTS = LOADED_AUTH_ENDPOINTS;
const API_ENDPOINTS = LOADED_API_ENDPOINTS;
const getAuthConfig = loadedGetAuthConfig;
const getApiConfig = loadedGetApiConfig;
const makeKey = loadedMakeKey;
const hashToken = loadedHashToken;
const verifyAccessToken = loadedVerifyAccessToken;
const verifyPurposeToken = loadedVerifyPurposeToken;
const { Users } = models;
const recordAccountLock = loadedRecordAccountLock;

/** A thrown value, as the log lines read it. */
const messageOf = (err: unknown): unknown => (err as { message?: unknown }).message;

/**
 * A counter as either store holds it: the three computed keys, and every other
 * key a previous write put there (V-14 — `revoked`, `blocked`, `blockUntil`, …).
 */
interface CounterEntry {
  count?: number;
  firstAttempt?: number;
  expiresAt?: number;
  revoked?: boolean;
  blocked?: boolean;
  blockUntil?: number;
  lockoutUntil?: number;
  [field: string]: unknown;
}

/** What authPreCheck and its siblings attach for the handler (`withAuthOutcome`). */
interface RateLimitContext {
  userId: string | null;
  tokenHash: string | null;
  ip: string | null | undefined;
  alsoByIp?: boolean;
  endpoint: string;
}

/** The request members this service reads or sets beyond Express's own. */
interface RateLimitRequest {
  rateLimitContext?: RateLimitContext;
}

/** A lockout check's answer. */
interface Lockout {
  locked: boolean;
  lockoutUntil?: Date;
  reason?: string;
}

// ============================================================
// REDIS CLIENT — the shared one, never a second one
// ============================================================

/**
 * The shared ioredis client when it can serve commands, otherwise null.
 *
 * A-30: this service used to build its own client inside a `getRedis()` that
 * was neither exported nor called, so `redisReady` was never true and every
 * counter lived in the in-process Map — lockouts reset on every deploy and
 * each replica enforced its own copy of the limit. It now follows the one
 * client `index.js` connects at startup through `initRedis()`.
 *
 * Readiness is `client.status === "ready"`. ioredis has NO `connected`
 * property — that was node-redis v3, and guarding on it is exactly what made
 * every redis.service helper a silent no-op until 2026-09-21. Do not
 * reintroduce it.
 *
 * Commands are never issued from a non-ready client: the shared client is
 * created with `lazyConnect`, so a command would dial out from whichever
 * process happened to touch the limiter first.
 *
 * @returns the ready client, or null
 */
function readyRedis(): Redis | null {
  try {
    const client = getRedisConnection();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain -- as built: a double may answer no client
    return client && client.status === "ready" ? client : null;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the message is interpolated whatever its type
    logger.warn(`Rate limiter could not reach the shared Redis client: ${messageOf(err)}`);
    return null;
  }
}

/**
 * The caller's address for a per-IP key: `req.ip`, else the socket's. Never a
 * request header (see THE IP IDENTIFIER below).
 *
 * @param req - `{ ip?, socket?: { remoteAddress? } }`
 * @returns the address, if any
 */
function clientAddress(req: { ip?: string | undefined; socket?: { remoteAddress?: string | undefined } | undefined }): string | undefined {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty req.ip falls back to the socket
  return req.ip || req.socket?.remoteAddress;
}

/**
 * ADR-100 (A-291) — whether FAILURES are also counted per client address.
 * AUTH_RATE_LIMIT_BY_IP decides when set ("true" / anything else); unset, it
 * is ON in production and off elsewhere. Since A-16 every proxy in front of
 * the backend sends the edge-resolved client address as the one
 * X-Forwarded-For hop, so in production req.ip is the client; the reference
 * VM has run with it on since A-67. Outside production every test browser
 * shares 127.0.0.1, so the default stays off there.
 *
 * @returns whether failures are also counted per address
 */
function countsFailuresByIp(): boolean {
  const flag = env("AUTH_RATE_LIMIT_BY_IP");
  if (flag !== undefined && flag !== "") {
    return flag === "true";
  }
  return env("NODE_ENV") === "production";
}

/**
 * ADR-100 — every 429 carries a Retry-After header (RFC 9110 §10.2.3) next to
 * the body's `retryAfter`, so a client and a proxy can both honour it.
 *
 * @param res - the response
 * @param seconds - the wait
 */
function setRetryAfter(res: Response, seconds: number): void {
  res.set("Retry-After", String(Math.max(1, Math.ceil(seconds))));
}

// ============================================================
// KEY DESIGN, AND WHAT HAPPENS WHEN REDIS IS DOWN
// ============================================================

// KEYS — `makeKey()` yields `ratelimit:<type>:<endpoint>:<identifier>`, where
// the identifier is a user id, a token hash or a client IP. There is no
// process, host or replica component, which is the point: every replica
// increments the same key. The window is the key's TTL, written atomically by
// the same script that increments the counter, and — exactly as the in-memory
// fallback has always done — each increment refreshes it, so the window is
// sliding: a counter only clears after a full quiet window. `firstAttempt` is
// preserved across increments, so the lockout end a caller reports stays
// anchored to the first failure rather than to the latest one.
//
// THE IP IDENTIFIER is `req.ip`, and only `req.ip` (A-16). Express derives it
// from X-Forwarded-For under a one-hop `trust proxy` (TRUST_PROXY_HOPS), and
// every proxy adjacent to the backend sends exactly one entry, the client
// address resolved at the edge (deploy/compose/nginx/*.conf, frontend
// src/lib/clientIp.ts). A raw X-Forwarded-For is never read here: it is the
// one header a client can write, so falling back to it would let a caller
// choose its own bucket. When req.ip is absent the socket address is used.
//
// Per-IP FAILURE counting is still switched off unless AUTH_RATE_LIMIT_BY_IP
// is "true" (noteAuthFailure). Turn it on for a deployment only after its
// stored session IPs have been seen to be real client addresses — until then
// req.ip may be one proxy address shared by every browser, and a per-IP lock
// would lock everyone. The per-user and per-token keys do not depend on it.
//
// OUTAGE POLICY — fail over to memory, never fail open. If Redis is not ready,
// or a command throws mid-flight, the counter is kept in this process's Map
// instead. A request is therefore never silently un-rate-limited because Redis
// blinked: it is still counted, just no longer counted globally.
//
// What that costs during an outage: counters are per process again, so with N
// replicas the effective limit is N x the configured one, and counts taken
// while Redis was down are not merged back when it returns. We take that over
// the alternatives. Failing CLOSED on a read — treating "Redis said nothing"
// as "locked" — turns a cache hiccup into a total authentication outage for
// every tenant. Failing OPEN — skipping the limit — hands an attacker the
// whole point of the control, since brute force then only requires waiting for
// a Redis blip. Degraded-but-counting is the only one of the three that is
// wrong in a bounded way.
//
// The single remaining fail-open is `endpointRateLimiter`'s outer catch, which
// calls next(). Every store operation now handles its own Redis failure, so
// that catch only sees programming errors — and it logs them.

// ============================================================
// IN-MEMORY FALLBACK (Redis outage only)
// ============================================================

// W-19 (ADR-079) — the fallback is BOUNDED. It used to expire an entry only
// when that key was read again, which a per-IP bucket from a one-off address
// never is: a spray from many addresses during an outage grew the Map for the
// life of the process. Now:
//  - a sweep every MEMORY_SWEEP_INTERVAL_MS deletes expired entries. Its timer
//    is unref'd (it cannot keep the process alive) and stops when the Map is
//    empty;
//  - the Map holds at most RATE_LIMIT_MEMORY_MAX_KEYS entries (default
//    100000). Writing a new key at the cap evicts the entry written longest
//    ago (a write moves its key to the end), and says so at `warn`, at most
//    once a minute. An evicted counter restarts from zero: at the cap, the
//    fallback under-counts rather than growing without limit.
const memoryStore = new Map<string, CounterEntry & { expiresAt: number }>();
const DEFAULT_MEMORY_MAX_KEYS = 100000;
const MEMORY_SWEEP_INTERVAL_MS = 60 * 1000;
let memorySweepTimer: NodeJS.Timeout | null = null;
let lastEvictionWarnAt = 0;

const memoryMaxKeys = (): number => {
  const n = Number(env("RATE_LIMIT_MEMORY_MAX_KEYS"));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MEMORY_MAX_KEYS;
};

/**
 * Delete every expired entry of the memory fallback (W-19).
 * @param now - the time to compare with
 * @returns entries removed
 */
function sweepMemoryStore(now: number = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of memoryStore) {
    if (now >= entry.expiresAt) {
      memoryStore.delete(key);
      removed += 1;
    }
  }
  if (memoryStore.size === 0 && memorySweepTimer) {
    clearInterval(memorySweepTimer);
    memorySweepTimer = null;
  }
  return removed;
}

function memoryGet(key: string): (CounterEntry & { expiresAt: number }) | null {
  const entry = memoryStore.get(key);
  if (!entry) {return null;}
  // ADR-100 Am. 5: a window ends AT expiresAt, as a Redis PX key does.
  if (Date.now() >= entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

function memorySet(key: string, value: CounterEntry | null, ttlMs: number): void {
  // Re-inserted, so the Map's order is last-written order.
  memoryStore.delete(key);
  const max = memoryMaxKeys();
  let evicted = 0;
  for (const oldest of memoryStore.keys()) {
    if (memoryStore.size < max) {break;}
    memoryStore.delete(oldest);
    evicted += 1;
  }
  if (evicted > 0 && Date.now() - lastEvictionWarnAt >= MEMORY_SWEEP_INTERVAL_MS) {
    lastEvictionWarnAt = Date.now();
    logger.warn(
      `Rate limiter memory fallback is at its cap of ${String(max)} keys (RATE_LIMIT_MEMORY_MAX_KEYS): ` +
        "the oldest counters are being evicted while Redis is unavailable",
    );
  }
  memoryStore.set(key, { ...value, expiresAt: Date.now() + ttlMs });
  if (!memorySweepTimer) {
    memorySweepTimer = setInterval(sweepMemoryStore, MEMORY_SWEEP_INTERVAL_MS);
    memorySweepTimer.unref();
  }
}

function memoryDel(key: string): void {
  memoryStore.delete(key);
}

// ============================================================
// UNIFIED STORAGE INTERFACE
// ============================================================

/**
 * Atomic counter increment, as ONE round trip.
 *
 * Read-then-write across two commands loses increments whenever two replicas
 * (or two requests on one replica) interleave, which is precisely the case the
 * limiter exists for. INCR + a separate PEXPIRE is atomic per command but not
 * as a pair: a process that dies between them leaves a counter with no TTL,
 * i.e. a lockout that never expires. The script does both under Redis's single
 * execution thread.
 *
 * It writes the same shape the memory store writes — `{ count, firstAttempt,
 * expiresAt }` — so callers that read `entry.expiresAt` (isTokenBlocked,
 * isUserLockedOut, getRateLimitStatus) behave identically on either backend.
 * KEYS[1] = key, ARGV[1] = ttl in ms, ARGV[2] = now in ms.
 * Returns the PREVIOUS raw value ("" when the key was absent) so the caller
 * can see flags such as `revoked` exactly as the read-then-write did.
 *
 * V-14 — the contract on the entry's keys: `count`, `firstAttempt` and
 * `expiresAt` are (re)computed; EVERY OTHER key of the previous entry
 * (`revoked`, `blocked`, `blockUntil`, …) is PRESERVED. Until 2026-09-30 the
 * script (and the memory path below) wrote only the three computed keys, so
 * the 4th failure on a token wiped the `revoked` flag the 3rd had set, and
 * the `!entry?.revoked` guard then stopped it being written again. The memory
 * fallback in storeIncrEntry follows the same contract.
 */
const INCR_ENTRY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local ttl = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local count = 1
local firstAttempt = now
local entry = {}
if raw then
  local ok, previous = pcall(cjson.decode, raw)
  if ok and type(previous) == 'table' then
    count = (previous.count or 0) + 1
    firstAttempt = previous.firstAttempt or now
    entry = previous
  else
    -- Something that is not one of our entries is sitting on this key. Treat
    -- it as absent and take it over: raising here would make this key fail
    -- every request back to the per-process Map, silently and forever.
    raw = false
  end
end
entry.count = count
entry.firstAttempt = firstAttempt
entry.expiresAt = now + ttl
redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', ttl)
return raw or ''
`;

async function storeGet(key: string): Promise<CounterEntry | null> {
  const client = readyRedis();
  if (client) {
    try {
      const data = await client.get(key);
      return data ? (JSON.parse(data) as CounterEntry) : null;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.warn(`Rate limiter Redis GET failed, reading the memory fallback: ${messageOf(err)}`);
    }
  }
  return memoryGet(key);
}

async function storeSet(key: string, value: CounterEntry, ttlMs: number): Promise<void> {
  const entry = { ...value, expiresAt: Date.now() + ttlMs };
  const client = readyRedis();
  if (client) {
    try {
      await client.set(key, JSON.stringify(entry), "PX", ttlMs);
      return;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.warn(`Rate limiter Redis SET failed, counting in memory: ${messageOf(err)}`);
    }
  }
  memorySet(key, value, ttlMs);
}

async function storeDel(key: string): Promise<void> {
  const client = readyRedis();
  if (client) {
    try {
      await client.del(key);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.warn(`Rate limiter Redis DEL failed: ${messageOf(err)}`);
    }
  }
  // Always clear the local copy too: a counter may have been recorded here
  // while Redis was down, and a reset that leaves it behind keeps a user
  // locked out of their own account after a successful login.
  memoryDel(key);
}

/**
 * Increment the counter at `key` and return the entry as it was BEFORE the
 * increment, together with the new count.
 *
 * @param key - the counter
 * @param ttlMs - the window
 * @param now - the time
 * @returns the entry before the increment, and the new count
 */
async function storeIncrEntry(key: string, ttlMs: number, now: number = Date.now()): Promise<{ previous: CounterEntry | null; count: number }> {
  const client = readyRedis();
  if (client) {
    try {
      const raw = (await client.eval(INCR_ENTRY_SCRIPT, 1, key, String(ttlMs), String(now))) as string;
      const previous = raw ? (JSON.parse(raw) as CounterEntry) : null;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 count is 0
      return { previous, count: (previous?.count || 0) + 1 };
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.warn(`Rate limiter Redis INCR failed, counting in memory: ${messageOf(err)}`);
    }
  }
  const previous = memoryGet(key);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 count is 0
  const count = (previous?.count || 0) + 1;
  // V-14: every other key of the previous entry is preserved (see the script).
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 firstAttempt is now
  memorySet(key, { ...previous, count, firstAttempt: previous?.firstAttempt || now }, ttlMs);
  return { previous, count };
}

async function storeIncr(key: string, ttlMs: number): Promise<number> {
  const { count } = await storeIncrEntry(key, ttlMs);
  return count;
}

// ============================================================
// ADR-100 Amendment 5 — FIXED WINDOWS FOR REQUEST BUDGETS
// ============================================================
//
// storeIncrEntry refreshes the key's TTL on EVERY increment: a sliding window
// that only clears after a full quiet window. That is right for a FAILURE
// counter (failures keep a guesser paused), and wrong for a REQUEST budget:
// a refused request counted, and pushed the window out again, so "5 an hour"
// behaved as "5, then an hour of silence", Retry-After was a lie the moment
// the client retried, and a retrying client (or every browser behind one NAT)
// stayed locked out indefinitely (P10-13 live E2E).
//
// A budget counter is a FIXED window instead: its expiry is set when the
// window opens and never moved. Requests inside it — admitted or refused —
// are counted against it, but none extends it, so the window closes exactly
// at `expiresAt`, which is what Retry-After reports.

const INCR_FIXED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local ttl = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
if raw and redis.call('PTTL', KEYS[1]) > 0 then
  local ok, entry = pcall(cjson.decode, raw)
  if ok and type(entry) == 'table' and entry.expiresAt then
    entry.count = (entry.count or 0) + 1
    redis.call('SET', KEYS[1], cjson.encode(entry), 'KEEPTTL')
    return cjson.encode(entry)
  end
end
local entry = { count = 1, firstAttempt = now, expiresAt = now + ttl }
redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', ttl)
return cjson.encode(entry)
`;

/**
 * Count one request against a FIXED window (ADR-100 Amendment 5): the window
 * opens at the first request and closes at `expiresAt`, whatever happens in
 * between. Redis when it is ready, else the bounded memory fallback.
 *
 * @param key - the counter
 * @param windowMs - the window
 * @param now - the time
 * @returns the count and when the window closes
 */
async function storeIncrFixed(key: string, windowMs: number, now: number = Date.now()): Promise<{ count: number; expiresAt: number }> {
  const client = readyRedis();
  if (client) {
    try {
      const raw = (await client.eval(INCR_FIXED_SCRIPT, 1, key, String(windowMs), String(now))) as string;
      const entry = JSON.parse(raw) as { count: number; expiresAt?: unknown };
      // The script always writes expiresAt; an answer without one (a foreign
      // script, a proxy) falls back to the window, never to NaN seconds.
      return { count: entry.count, expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : now + windowMs };
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.warn(`Rate limiter Redis fixed-window INCR failed, counting in memory: ${messageOf(err)}`);
    }
  }
  const previous = memoryGet(key);
  // P9-18: the JavaScript also tested `typeof previous.expiresAt === "number"`.
  // That arm could never be false — every memory entry is written by
  // memorySet (`expiresAt: Date.now() + ttlMs`, a number even when NaN) or
  // re-inserted below with the number it already had — and memoryGet's type
  // now says so, so the dead test is gone rather than ignored for coverage.
  if (previous) {
    // P9-18: the JavaScript wrote `(previous.count || 0) + 1`. The `0` arm could
    // never be taken — every memory entry carries a count >= 1 (storeIncrEntry
    // writes one, storeSet's two callers pass one, this function writes 1 and
    // then adds) — so it is dropped rather than ignored for coverage (A-32).
    const entry = { ...previous, count: (previous.count as number) + 1 };
    // Its expiry untouched (not memorySet, which would start a new window);
    // re-inserted, so the Map's order stays last-written order and the W-19
    // eviction keeps a counter that is still being written.
    memoryStore.delete(key);
    memoryStore.set(key, entry);
    return { count: entry.count, expiresAt: entry.expiresAt };
  }
  memorySet(key, { count: 1, firstAttempt: now }, windowMs);
  return { count: 1, expiresAt: (memoryStore.get(key) as { expiresAt: number }).expiresAt };
}

/**
 * Clear all in-memory rate limit data (for testing).
 */
function clearMemoryStore(): void {
  memoryStore.clear();
  sweepMemoryStore();
  lastEvictionWarnAt = 0;
}

/** W-19: the memory fallback's size and whether its sweep is running (tests, diagnostics). */
function memoryStoreStats(): { size: number; maxKeys: number; sweeping: boolean } {
  return { size: memoryStore.size, maxKeys: memoryMaxKeys(), sweeping: memorySweepTimer !== null };
}

// ============================================================
// AUTH ENDPOINT RATE LIMITING (brute-force protection)
// ============================================================

/**
 * A-126 — the account a sign-in lock is engaging on, for its ACCOUNT_LOCKED
 * row. Null when there is no such account, or when it cannot be read: the lock
 * is then persisted without its row, because the lock must never depend on
 * the audit trail (audit.service#recordAccountLock).
 *
 * @param userId - from a verified token
 * @returns the account, or null
 */
async function lockedAccount(userId: string): Promise<{ id: string; tenantId: string | null } | null> {
  try {
    // Pre-auth there is no tenant context; the opt-out says so explicitly.
    return await Users.findByPk(userId, { attributes: ["id", "tenantId"], skipTenantScope: true });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
    logger.error(`Could not load the account being locked: ${messageOf(err)}`);
    return null;
  }
}

/**
 * Check and record a failed auth attempt.
 * Returns lockout status if limit exceeded.
 *
 * @param params - `userId`, `tokenHash`, `ip` (each optional), `alsoByIp`,
 *   `endpoint` (login, register, forgotPassword, resetPassword, …) and `audit`
 *   (A-126: the request's address and agent for the ACCOUNT_LOCKED row —
 *   separate from `ip`, which is a COUNTING key and is null unless
 *   AUTH_RATE_LIMIT_BY_IP is on)
 * @returns { allowed, remainingAttempts, lockoutUntil, lockoutReason, revokedToken }
 */
async function recordAuthFailure({
  userId = null,
  tokenHash = null,
  ip = null,
  alsoByIp = false,
  endpoint,
  audit = {},
}: {
  userId?: string | null;
  tokenHash?: string | null;
  ip?: string | null | undefined;
  alsoByIp?: boolean | undefined;
  endpoint: string;
  audit?: { ipAddress?: string | null; userAgent?: string | null };
}): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  lockoutUntil: Date | null;
  lockoutReason: string | null;
  revokedToken: string | null;
}> {
  const config = getAuthConfig(endpoint);
  const now = Date.now();

  const results: {
    allowed: boolean;
    remainingAttempts: number;
    lockoutUntil: Date | null;
    lockoutReason: string | null;
    revokedToken: string | null;
  } = {
    allowed: true,
    remainingAttempts: config.maxAttempts,
    lockoutUntil: null,
    lockoutReason: null,
    revokedToken: null,
  };

  // ---- USER-BASED TRACKING ----
  if (userId) {
    const userKey = makeKey("auth", endpoint, `user:${userId}`);
    const ttlMs = config.windowMs;
    // One atomic round trip: two replicas failing the same account at the same
    // moment used to read the same count and each write count+1, losing a
    // failure and pushing the lockout out by one attempt per collision.
    const { count } = await storeIncrEntry(userKey, ttlMs, now);
    results.remainingAttempts = Math.max(0, config.maxAttempts - count);

    if (count >= config.maxAttempts) {
      results.allowed = false;
      results.lockoutUntil = new Date(now + config.lockoutMs);
      results.lockoutReason = `Too many failed attempts on ${config.description}`;
    }

    // Persist lockout to DB — the sign-in lock. Not for an endpoint whose
    // lock must stay its own (A-142, `persistUserLockout: false`).
    if (count >= config.maxAttempts && config.persistUserLockout !== false) {
      const lock = { failedLoginAttempts: count, lockedUntil: results.lockoutUntil };
      const persistLock = (transaction: unknown): Promise<unknown> =>
        Users.update(lock, (transaction ? { where: { id: userId }, transaction } : { where: { id: userId } }) as unknown as UpdateOptions<Attributes<ModelInstance<"User">>>);
      try {
        // A-126 (ADR-051 Q-15): the lock ENGAGES on the attempt that reaches
        // the budget, and that attempt writes the ACCOUNT_LOCKED row with it.
        // A racing attempt past the budget re-writes the lock, unaudited. The
        // id comes from a verified token, never a typed name, and a row is
        // written only for an account that exists (audit.service#recordAccountLock).
        const account = count === config.maxAttempts ? await lockedAccount(userId) : null;
        if (account) {
          const lockRecord = {
            persistLock,
            user: account,
            lockedUntil: results.lockoutUntil,
            failedAttempts: count,
            endpoint,
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address is null
            ipAddress: audit.ipAddress || null,
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty agent is null
            userAgent: audit.userAgent || null,
          };
          await recordAccountLock(lockRecord as Parameters<typeof recordAccountLock>[0]);
        } else {
          await persistLock(null);
        }
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
        logger.error(`Failed to persist user lockout: ${messageOf(err)}`);
      }
    }
  }

  // ---- TOKEN-BASED TRACKING (revokes token on brute force) ----
  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    const ttlMs = config.windowMs;

    const { previous: entry, count } = await storeIncrEntry(tokenKey, ttlMs, now);
    // Resolved once, here, where `entry` really can be absent — the later
    // writes reuse it instead of repeating a `|| now` fallback that can never
    // be taken (count >= 3 implies a prior entry) and so could never be tested.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 firstAttempt is now
    const firstAttempt = entry?.firstAttempt || now;

    // Track remaining attempts for token
    results.remainingAttempts = Math.max(0, config.maxAttempts - count);

    // Revoke token after 3 failures with same token (on 3rd failure)
    if (count >= 3 && !entry?.revoked) {
      await storeSet(tokenKey, { count, revoked: true, firstAttempt }, ttlMs);
      logger.warn(`Token revoked due to brute force on ${endpoint}`, { tokenHash });
    }

    // Return revokedToken on the call after revocation (4th failure when count=3 triggered revocation)
    if (count >= 4 && entry?.revoked) {
      results.revokedToken = tokenHash;
    }

    // Hard block after 2x maxAttempts
    if (count >= config.maxAttempts * 2) {
      const blockUntil = now + 24 * 60 * 60 * 1000; // 24h
      // V-14: the block keeps the revocation (count >= 3 has revoked it).
      await storeSet(tokenKey, { count, revoked: count >= 3, blocked: true, blockUntil, firstAttempt }, ttlMs);
      results.allowed = false;
      results.lockoutUntil = new Date(blockUntil);
      results.lockoutReason = "Token blocked due to excessive failed attempts";
    }
  }

  // ---- IP-BASED ----
  // A fallback for a caller with no user or token — unless the endpoint asks
  // for the address to be counted as well (`alsoByIp`, A-81: /mfa/login always
  // has a token, and a fresh token costs an attacker only the password).
  if (ip && (alsoByIp || (!userId && !tokenHash))) {
    const ipKey = makeKey("auth", endpoint, `ip:${ip}`);
    const count = await storeIncr(ipKey, config.windowMs);
    if (count >= config.maxAttempts * 3) {
      results.allowed = false;
      results.lockoutUntil = new Date(now + 5 * 60 * 1000); // 5 min
      results.lockoutReason = "Too many requests from this IP";
    }
  }

  return results;
}

/**
 * When a counter-backed lock ends: the counter's own expiry (Redis and the
 * memory fallback both store `expiresAt`), else — an entry written before
 * expiries were stored — `now + fallbackMs`.
 *
 * @param entry - `{ expiresAt? }`
 * @param now - the time
 * @param fallbackMs - the lock's length when the entry has no expiry
 * @returns when the lock ends
 */
function lockEnd(entry: CounterEntry, now: number, fallbackMs: number): Date {
  return new Date(typeof entry.expiresAt === "number" ? entry.expiresAt : now + fallbackMs);
}

/**
 * Check if a user/token/IP is currently locked out (without recording attempt).
 */
async function checkAuthLockout({
  userId = null,
  tokenHash = null,
  ip = null,
  alsoByIp = false,
  endpoint,
}: {
  userId?: string | null;
  tokenHash?: string | null;
  ip?: string | null | undefined;
  alsoByIp?: boolean | undefined;
  endpoint: string;
}): Promise<Lockout> {
  const config = getAuthConfig(endpoint);
  const now = Date.now();

  if (userId) {
    const userKey = makeKey("auth", endpoint, `user:${userId}`);
    const entry = await storeGet(userKey);
    if (entry && (entry.count as number) >= config.maxAttempts) {
      // ADR-100 Amendment 5: the lock ends when its counter expires — that
      // key's real expiry, which no refused attempt moves (authPreCheck
      // refuses before anything is counted). `firstAttempt + lockoutMs` was a
      // different instant whenever failures were spread over the window.
      return { locked: true, lockoutUntil: lockEnd(entry, now, config.lockoutMs), reason: "Account temporarily locked" };
    }
  }

  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    const entry = await storeGet(tokenKey);
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `entry && entry.revoked`
    if (entry && entry.revoked) {
      return { locked: true, lockoutUntil: new Date((entry.firstAttempt as number) + 24 * 60 * 60 * 1000), reason: "Token revoked" };
    }
  }

  if (ip && (alsoByIp || (!userId && !tokenHash))) {
    const ipKey = makeKey("auth", endpoint, `ip:${ip}`);
    const entry = await storeGet(ipKey);
    if (entry && (entry.count as number) >= config.maxAttempts * 3) {
      // ADR-100 Amendment 5: "now + 5 minutes" on every check was a lock that
      // never seemed to end; the counter's expiry is when it does.
      return { locked: true, lockoutUntil: lockEnd(entry, now, 5 * 60 * 1000), reason: "IP blocked" };
    }
  }

  return { locked: false };
}

/**
 * Reset auth failure counters on successful login.
 */
async function resetAuthFailures({
  userId = null,
  tokenHash = null,
  endpoint,
}: {
  userId?: string | null;
  tokenHash?: string | null;
  endpoint: string;
  [field: string]: unknown;
}): Promise<void> {
  if (userId) {
    const userKey = makeKey("auth", endpoint, `user:${userId}`);
    await storeDel(userKey);
  }
  // A success on an endpoint that never writes the sign-in lock must not
  // clear it either (A-142).
  if (userId && getAuthConfig(endpoint).persistUserLockout !== false) {
    try {
      await Users.update({ failedLoginAttempts: 0, lockedUntil: null }, { where: { id: userId } });
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.error(`Failed to clear user lockout: ${messageOf(err)}`);
    }
  }
  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    await storeDel(tokenKey);
  }
}

// ============================================================
// API ENDPOINT RATE LIMITING (request quotas)
// ============================================================

/**
 * Express middleware for generic endpoint rate limiting.
 * Returns 429 with X-RateLimit-* headers when exceeded.
 *
 * @param endpointKey - Key from API_ENDPOINTS config
 * @param options - `byUser` (default true): track by user ID if
 *   authenticated; `byToken` (default true): by token hash; `byIp` (default
 *   true): by IP; `maxRequests` / `windowMs` override the configuration
 * @returns Express middleware
 */
function endpointRateLimiter(
  endpointKey: string,
  options: { byUser?: boolean; byToken?: boolean; byIp?: boolean; maxRequests?: number; windowMs?: number } = {},
): RequestHandler {
  const { byUser = true, byToken = true, byIp = true, maxRequests, windowMs } = options;
  const config = getApiConfig(endpointKey);
  // Allow overriding maxRequests and windowMs via options
  const effectiveMaxRequests = maxRequests ?? config.maxRequests;
  const effectiveWindowMs = windowMs ?? config.windowMs;
  const effectiveDescription = config.description;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const keys: string[] = [];

      if (byUser && req.user?.id) {
        keys.push(makeKey("api", endpointKey, `user:${req.user.id}`));
      }
      if (byToken) {
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (token) {
          keys.push(makeKey("api", endpointKey, `token:${hashToken(token)}`));
        }
      }
      if (byIp) {
        const ip = clientAddress(req);
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: an absent address is keyed "undefined"
        keys.push(makeKey("api", endpointKey, `ip:${ip}`));
      }

      // Check all keys; if ANY exceeds limit, reject
      for (const key of keys) {
        // ADR-100 Amendment 5: a FIXED window, written atomically with its
        // count; a refused request never extends it, so Retry-After is true.
        const { count, expiresAt } = await storeIncrFixed(key, effectiveWindowMs);

        if (count > effectiveMaxRequests) {
          const retryAfter = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
          setRetryAfter(res, retryAfter);
          return res.status(429).json({
            success: false,
            status: 429,
            message: `Too many requests. ${effectiveDescription} limit exceeded.`,
            retryAfter,
          });
        }

        // Set headers on first key checked
        if (key === keys[0]) {
          res.set({
            "X-RateLimit-Limit": String(effectiveMaxRequests),
            "X-RateLimit-Remaining": String(Math.max(0, effectiveMaxRequests - count)),
            "X-RateLimit-Reset": String(Math.ceil((Date.now() + effectiveWindowMs) / 1000)),
          });
        }
      }

      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.error(`Rate limiter error: ${messageOf(err)}`);
      next(); // Fail open
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    }
  };
}

/**
 * Get current rate limit status for monitoring (no increment).
 */
async function getRateLimitStatus({
  userId = null,
  tokenHash = null,
  ip = null,
  endpoint,
  type = "api",
}: {
  userId?: string | null;
  tokenHash?: string | null;
  ip?: string | null;
  endpoint: string;
  type?: string;
}): Promise<{ user: Record<string, unknown> | null; token: Record<string, unknown> | null; ip: Record<string, unknown> | null }> {
  const configs = (type === "auth" ? getAuthConfig(endpoint) : getApiConfig(endpoint)) as { maxAttempts?: number };
  const status: { user: Record<string, unknown> | null; token: Record<string, unknown> | null; ip: Record<string, unknown> | null } = { user: null, token: null, ip: null };

  if (userId) {
    const userKey = makeKey(type, endpoint, `user:${userId}`);
    const entry = await storeGet(userKey);
    status.user = entry ? { count: entry.count, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null, isLocked: type === "auth" && (entry.count as number) >= (configs.maxAttempts as number) } : null;
  }

  if (tokenHash) {
    const tokenKey = makeKey(type, endpoint, `token:${tokenHash}`);
    const entry = await storeGet(tokenKey);
    status.token = entry ? { count: entry.count, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null, isBlocked: entry.blocked === true } : null;
  }

  if (ip) {
    const ipKey = makeKey(type, endpoint, `ip:${ip}`);
    const entry = await storeGet(ipKey);
    status.ip = entry ? { count: entry.count, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null } : null;
  }

  return status;
}

/**
 * Clear all rate limits for a user (admin action).
 */
async function clearUserRateLimits(userId: unknown): Promise<void> {
  if (!userId) {return;}
  // Note: This is best-effort with pattern matching if using Redis
  // For simplicity, we clear known keys
  const endpoints = [...Object.keys(AUTH_ENDPOINTS), ...Object.keys(API_ENDPOINTS)];
  for (const endpoint of endpoints) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built: the id is interpolated as given
    await storeDel(makeKey("auth", endpoint, `user:${userId}`));
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built
    await storeDel(makeKey("api", endpoint, `user:${userId}`));
  }
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built
  logger.info(`Cleared rate limits for user ${userId}`);
}

// A-340: the two session revokers this module offered were removed (2026-10-01). They
// updated `sessions` through camelCase keys the snake_case Session model does not have, so
// they revoked nothing, and nothing called them. Revocation lives in session.service.

/**
 * Check if a token is blocked.
 * @param token - Raw token
 * @param endpoint - Endpoint path (optional)
 * @returns Block status
 */
async function isTokenBlocked(token: string, endpoint: string | null = null): Promise<{ isBlocked: boolean; blockUntil?: Date; reason?: string }> {
  const tokenHash = hashToken(token);
  const key = makeKey("auth", endpoint as string, `token:${tokenHash}`);
  const entry = await storeGet(key);
  const now = Date.now();

  if (entry && now < (entry.expiresAt as number) && entry.blocked) {
    return {
      isBlocked: true,
      blockUntil: new Date(entry.blockUntil as number),
      reason: "Token blocked due to suspicious activity",
    };
  }

  return { isBlocked: false };
}

/**
 * Check if a user is locked out.
 * @param userId - User ID
 * @param endpoint - Endpoint path (optional)
 * @returns Lockout status
 */
async function isUserLockedOut(
  userId: string,
  endpoint: string | null = null,
): Promise<{ isLocked: boolean; lockoutUntil?: Date; remainingAttempts: number; reason?: string }> {
  const config = getAuthConfig(endpoint as string);
  const key = makeKey("auth", endpoint as string, `user:${userId}`);
  const entry = await storeGet(key);
  const now = Date.now();

  if (entry && now < (entry.expiresAt as number) && (entry.count as number) >= config.maxAttempts) {
    return {
      isLocked: true,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 lockoutUntil falls back
      lockoutUntil: new Date(entry.lockoutUntil || now + config.lockoutMs),
      remainingAttempts: 0,
      reason: "Account temporarily locked due to too many failed attempts",
    };
  }

  return {
    isLocked: false,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 count is 0
    remainingAttempts: config.maxAttempts - (entry?.count || 0),
  };
}

// ============================================================
// MIDDLEWARE FACTORIES FOR AUTH ROUTES
// ============================================================

/**
 * Middleware to check auth lockout BEFORE processing login/register.
 */
function authPreCheck(endpoint: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      const tokenHash = token ? hashToken(token) : null;
      const ip = clientAddress(req);

      let userId: string | null = null;
      if (token) {
        try {
          const decoded = verifyAccessToken(token);
          userId = (decoded as { id?: unknown }).id as string | null;
        } catch {
          // Invalid token, ignore for userId check
        }
      }

      const lockout = await checkAuthLockout({ userId, tokenHash, ip, endpoint });
      if (lockout.locked) {
        // As built: a Date minus a number is the milliseconds between them.
        setRetryAfter(res, ((lockout.lockoutUntil as unknown as number) - Date.now()) / 1000);
        return res.status(429).json({
          success: false,
          status: 429,
          message: lockout.reason,
          lockoutUntil: (lockout.lockoutUntil as Date).toISOString(),
          retryAfter: Math.ceil(((lockout.lockoutUntil as unknown as number) - Date.now()) / 1000),
        });
      }

      // Attach for post-processing
      (req as Request & RateLimitRequest).rateLimitContext = { userId, tokenHash, ip, endpoint };
      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.error(`Auth pre-check error: ${messageOf(err)}`);
      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    }
  };
}

/**
 * A-81 — the lockout check for POST /auth/mfa/login.
 *
 * The second factor was unthrottled: a 6-digit TOTP has 10^6 values, the MFA
 * token lives five minutes, and a fresh token costs only the password — so a
 * stolen password and an unlimited endpoint defeated the second factor.
 *
 * authPreCheck cannot serve here: it reads the principal from an
 * Authorization header, and the MFA token travels in the body. This reads it
 * from there and keys the attempt three ways:
 *   - the USER the token names — the one that matters, because minting a new
 *     token does not reset it. It locks at `mfaLogin.maxAttempts` failures,
 *     and recordAuthFailure then also writes users.locked_until, which
 *     loginMfa and loginUser both honour (A-83);
 *   - the TOKEN — revoked after three failures, as on every auth endpoint;
 *   - the ADDRESS, when AUTH_RATE_LIMIT_BY_IP is on (`alsoByIp`), so one
 *     source cannot spread its guesses across many accounts.
 * The handler records the outcome (auth.controller.js `withAuthOutcome`).
 *
 * @returns the middleware
 */
function mfaLoginPreCheck(): RequestHandler {
  const endpoint = "mfaLogin";
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { token?: unknown } | undefined;
      const token = typeof body?.token === "string" ? body.token : null;
      const tokenHash = token ? hashToken(token) : null;
      const ip = clientAddress(req);

      let userId: string | null = null;
      if (token) {
        try {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id is null
          userId = ((verifyPurposeToken(token, "mfa") as { id?: unknown }).id as string | null | undefined) || null;
        } catch {
          // An invalid token names no user; it is still counted by its hash.
        }
      }

      const context = { userId, tokenHash, ip, alsoByIp: true, endpoint };
      const lockout = await checkAuthLockout(context);
      if (lockout.locked) {
        // As built: a Date minus a number is the milliseconds between them.
        setRetryAfter(res, ((lockout.lockoutUntil as unknown as number) - Date.now()) / 1000);
        return res.status(429).json({
          success: false,
          status: 429,
          message: lockout.reason,
          lockoutUntil: (lockout.lockoutUntil as Date).toISOString(),
          retryAfter: Math.ceil(((lockout.lockoutUntil as unknown as number) - Date.now()) / 1000),
        });
      }

      (req as Request & RateLimitRequest).rateLimitContext = context;
      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.error(`MFA login pre-check error: ${messageOf(err)}`);
      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    }
  };
}

/**
 * A-142 — the lockout check for the SIGNED-IN MFA endpoints: POST
 * /auth/mfa/setup, /auth/mfa/verify and /auth/mfa/disable.
 *
 * Each checks a code (and setup-as-rotation and disable a password) for
 * whoever holds the session, and none was throttled: a stolen session could
 * guess the current code for a rotation or a disable without limit. Mounted
 * AFTER `auth`, so the principal is the authenticated user (`req.user.id`) —
 * never a body field. Keys:
 *   - the USER — one `mfaManage` bucket across all three endpoints;
 *   - the ADDRESS, only when AUTH_RATE_LIMIT_BY_IP is "true" (see THE IP
 *     IDENTIFIER): until a deployment's req.ip is known to be the client, a
 *     per-IP lock could lock every user behind one proxy address.
 * There is no per-token key: the access token is the session, and the user
 * key already covers every session of that user.
 *
 * The handler records the outcome (auth.controller.js `withAuthOutcome`).
 *
 * @returns the middleware
 */
function mfaManagePreCheck(): RequestHandler {
  const endpoint = "mfaManage";
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id is null
        userId: req.user?.id || null,
        tokenHash: null,
        ip: countsFailuresByIp() ? clientAddress(req) : null,
        alsoByIp: true,
        endpoint,
      };
      const lockout = await checkAuthLockout(context);
      if (lockout.locked) {
        // As built: a Date minus a number is the milliseconds between them.
        setRetryAfter(res, ((lockout.lockoutUntil as unknown as number) - Date.now()) / 1000);
        return res.status(429).json({
          success: false,
          status: 429,
          message: "Too many failed MFA attempts. Try again later.",
          lockoutUntil: (lockout.lockoutUntil as Date).toISOString(),
          retryAfter: Math.ceil(((lockout.lockoutUntil as unknown as number) - Date.now()) / 1000),
        });
      }

      (req as Request & RateLimitRequest).rateLimitContext = context;
      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      logger.error(`MFA management pre-check error: ${messageOf(err)}`);
      next();
      // As built: undefined after next(), stated for noImplicitReturns.
      return undefined;
    }
  };
}

// A-67 — RECORDING THE OUTCOME
//
// This used to be two middlewares, `authPostFailure` mounted BEFORE the
// controller and `authPostSuccess` mounted AFTER it. The first ran while the
// status was still 200, so it never saw a failure; the second sat behind a
// controller that sends the response and never calls next(), so it never ran.
// Every auth lockout this service implements was therefore a no-op on login,
// register, send-OTP and reset-password.
//
// The outcome is now recorded by the handler itself (auth.controller.js
// `withAuthOutcome`, sso.controller.js ssoExchange), which is the only code
// that knows the outcome — and it records a failure BEFORE the error response
// is sent, so a client cannot learn the result of attempt N and send attempt
// N+1 ahead of the count.

/**
 * Count a failed attempt against whatever authPreCheck attached to the request.
 * Never throws: a limiter fault must not turn a 401 into a 500.
 *
 * @param req - carries `rateLimitContext` from authPreCheck
 * @param endpoint - AUTH_ENDPOINTS key
 */
async function noteAuthFailure(req: Request, endpoint: string): Promise<void> {
  try {
    // A-67 / A-16: until a deployment's req.ip is known to be the client
    // (see THE IP IDENTIFIER above), it may be one proxy address shared by
    // every browser, and a per-IP count would let anyone lock login for
    // everyone. Count by IP only where AUTH_RATE_LIMIT_BY_IP says so.
    const context: Partial<RateLimitContext> = { ...(req as Request & RateLimitRequest).rateLimitContext };
    if (!countsFailuresByIp()) {
      context.ip = null;
    }
    // A-126: what an ACCOUNT_LOCKED row records — never a counting key.
    const audit = {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address is null
      ipAddress: clientAddress(req) || null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-condition -- as built: `req.headers?.[…] || null`
      userAgent: req.headers?.["user-agent"] || null,
    };
    await recordAuthFailure({ ...context, endpoint, audit });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
    logger.error(`Auth failure recording error on ${endpoint}: ${messageOf(err)}`);
  }
}

/**
 * Clear the per-user and per-token counters after a success. The per-IP
 * counter is deliberately NOT cleared (resetAuthFailures takes no ip): one
 * valid account must not buy an address a fresh budget of guesses against
 * every other account.
 *
 * @param req - carries `rateLimitContext` from authPreCheck
 * @param endpoint - AUTH_ENDPOINTS key
 */
async function noteAuthSuccess(req: Request, endpoint: string): Promise<void> {
  const context = (req as Request & RateLimitRequest).rateLimitContext;
  if (!context) {
    return;
  }
  try {
    await resetAuthFailures({ ...context, endpoint });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
    logger.error(`Auth success reset error on ${endpoint}: ${messageOf(err)}`);
  }
}

// ============================================================
// A-185 — THE PASSWORD SIGN-IN THROTTLE
// ============================================================
//
// It used to be a hard ACCOUNT lock: the fifth wrong password for a REAL
// username wrote users.locked_until and answered 423, while an unknown one
// answered 401 forever. That was an existence oracle, and it let anyone who
// knew a username lock its owner out, repeatedly, from anywhere.
//
// Now the counters are keyed by what the CALLER typed, never by whether it
// names an account, so a real name and an invented one are throttled
// identically:
//
//   pair     — identifier + address. Five failures pause THAT pair for fifteen
//              minutes (AUTH_ENDPOINTS.login). The owner signing in from
//              anywhere else is unaffected.
//   ceiling  — identifier alone, across every address. A hundred failures in
//              an hour pause the identifier everywhere
//              (AUTH_ENDPOINTS.loginIdentifier): the bound on a guesser who
//              rotates addresses.
//
// The identifier is trimmed, lower-cased and hashed (SHA-256) before it is a
// key: the store never holds a typed username or address in the clear.
//
// The address is req.ip (A-16). Where a deployment's req.ip is one proxy
// address shared by every browser, the pair collapses to the identifier
// alone — no weaker than the lock it replaces, and bounded to fifteen minutes.
// Keying the PAIR by address can only narrow a pause, never widen it, so it
// does not depend on AUTH_RATE_LIMIT_BY_IP (which widens a pause to every
// name from one address).

/**
 * @param identifier - as typed
 * @returns the hash the keys carry
 */
function loginIdentifierHash(identifier: unknown): string {
  return crypto
    .createHash("sha256")
    .update(String(identifier).trim().toLowerCase())
    .digest("hex");
}

/** A password sign-in attempt, as the throttle keys it. */
interface LoginAttempt {
  identifier: string;
  ip?: string | null | undefined;
}

/**
 * @param attempt - `{ identifier, ip? }`
 * @returns the pair and ceiling keys
 */
function loginThrottleKeys({ identifier, ip }: LoginAttempt): { pairKey: string; ceilingKey: string } {
  const id = loginIdentifierHash(identifier);
  return {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address is "unknown"
    pairKey: makeKey("auth", "login", `pair:${id}:${ip || "unknown"}`),
    ceilingKey: makeKey("auth", "loginIdentifier", `id:${id}`),
  };
}

/**
 * Whether this identifier may attempt a password sign-in from this address
 * now. Checked BEFORE the account is looked up, so a paused attempt costs no
 * lookup and no password comparison, and says nothing about the account.
 *
 * @param attempt - `{ identifier, ip? }`
 * @returns whether paused, and for how long
 */
async function checkLoginThrottle(attempt: LoginAttempt): Promise<{ throttled: boolean; retryAfterSeconds: number }> {
  const { pairKey, ceilingKey } = loginThrottleKeys(attempt);
  const now = Date.now();
  for (const [key, endpoint] of [
    [pairKey, "login"],
    [ceilingKey, "loginIdentifier"],
  ] as const) {
    const entry = await storeGet(key);
    if (entry && (entry.count as number) >= getAuthConfig(endpoint).maxAttempts) {
      return {
        throttled: true,
        retryAfterSeconds: Math.max(1, Math.ceil(((entry.expiresAt as number) - now) / 1000)),
      };
    }
  }
  return { throttled: false, retryAfterSeconds: 0 };
}

/**
 * Count one failed password sign-in against the pair and the ceiling.
 *
 * `engaged` names the counter this attempt filled — once per window: the
 * caller writes the ACCOUNT_LOCKED row then, and only for an account that
 * exists (which the answer never shows).
 *
 * @param attempt - `{ identifier, ip? }`
 * @returns which counter this attempt filled, the count, and the pause's end
 */
async function recordLoginFailure(
  attempt: LoginAttempt,
): Promise<{ engaged: null | "identifier+address" | "identifier"; failedAttempts: number; pausedUntil: Date | null }> {
  const { pairKey, ceilingKey } = loginThrottleKeys(attempt);
  const now = Date.now();
  const pairConfig = getAuthConfig("login");
  const ceilingConfig = getAuthConfig("loginIdentifier");
  const { count: pairCount } = await storeIncrEntry(pairKey, pairConfig.windowMs, now);
  const { count: ceilingCount } = await storeIncrEntry(ceilingKey, ceilingConfig.windowMs, now);

  if (ceilingCount === ceilingConfig.maxAttempts) {
    return {
      engaged: "identifier",
      failedAttempts: ceilingCount,
      pausedUntil: new Date(now + ceilingConfig.lockoutMs),
    };
  }
  if (pairCount === pairConfig.maxAttempts) {
    return {
      engaged: "identifier+address",
      failedAttempts: pairCount,
      pausedUntil: new Date(now + pairConfig.lockoutMs),
    };
  }
  return { engaged: null, failedAttempts: pairCount, pausedUntil: null };
}

/**
 * A successful sign-in clears its own pair. The ceiling is NOT cleared: the
 * owner succeeding from one address must not hand a distributed guesser a
 * fresh hundred.
 *
 * @param attempt - `{ identifier, ip? }`
 */
async function clearLoginThrottle(attempt: LoginAttempt): Promise<void> {
  await storeDel(loginThrottleKeys(attempt).pairKey);
}

// ============================================================
// A-260 — SIGNED-IN PASSWORD CHECKS
// ============================================================
//
// POST /auth/pass-is-valid, the change-password route and every fresh
// re-authentication (auth.service#verifySessionPassword) compare a typed
// password with the CALLER'S OWN hash. None was counted, so whoever held a
// session could guess the password there without the sign-in throttle. One
// counter per user (AUTH_ENDPOINTS.passwordCheck) covers all of them. The key
// is the user id from the verified session, never request input. There is no
// per-address key: the session already names the one principal guessing.

/**
 * @param userId - the signed-in user
 * @returns the counter's key
 */
function passwordCheckKey(userId: string): string {
  return makeKey("auth", "passwordCheck", `user:${userId}`);
}

/**
 * Whether this user's password may be checked now. Asked BEFORE the
 * comparison, so a spent budget learns nothing.
 *
 * @param userId - the signed-in user
 * @returns whether paused, and for how long
 */
async function checkPasswordCheckBudget(userId: string): Promise<{ throttled: boolean; retryAfterSeconds: number }> {
  const entry = await storeGet(passwordCheckKey(userId));
  if (entry && (entry.count as number) >= getAuthConfig("passwordCheck").maxAttempts) {
    return {
      throttled: true,
      retryAfterSeconds: Math.max(1, Math.ceil(((entry.expiresAt as number) - Date.now()) / 1000)),
    };
  }
  return { throttled: false, retryAfterSeconds: 0 };
}

/**
 * Count one wrong password. `engaged` is true on the one attempt that fills
 * the budget: the caller audits then, once per window. A racing attempt past
 * the budget is `exhausted` but not `engaged`.
 *
 * @param userId - the signed-in user
 * @returns `{ engaged, exhausted, failedAttempts, pausedUntil, retryAfterSeconds }`
 */
async function recordPasswordCheckFailure(userId: string): Promise<{
  engaged: boolean;
  exhausted: boolean;
  failedAttempts: number;
  pausedUntil: Date;
  retryAfterSeconds: number;
}> {
  const config = getAuthConfig("passwordCheck");
  const now = Date.now();
  const { count } = await storeIncrEntry(passwordCheckKey(userId), config.windowMs, now);
  return {
    engaged: count === config.maxAttempts,
    exhausted: count >= config.maxAttempts,
    failedAttempts: count,
    // The increment refreshed the window, so the pause ends one window from now.
    pausedUntil: new Date(now + config.lockoutMs),
    retryAfterSeconds: Math.ceil(config.lockoutMs / 1000),
  };
}

/**
 * The right password clears the count: only the holder of the password can
 * produce it, so it hands a guesser nothing.
 *
 * @param userId - the signed-in user
 */
async function clearPasswordCheckBudget(userId: string): Promise<void> {
  await storeDel(passwordCheckKey(userId));
}

export = {
  // A-260: signed-in password checks
  checkPasswordCheckBudget,
  recordPasswordCheckFailure,
  clearPasswordCheckBudget,

  // Core functions
  // A-185: the password sign-in throttle
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginThrottle,
  loginIdentifierHash,

  recordAuthFailure,
  checkAuthLockout,
  resetAuthFailures,
  endpointRateLimiter,
  getRateLimitStatus,
  clearUserRateLimits,

  // Token/User management
  isTokenBlocked,
  isUserLockedOut,

  // Auth route middleware
  authPreCheck,
  mfaLoginPreCheck,
  mfaManagePreCheck,
  noteAuthFailure,
  noteAuthSuccess,

  // Config access
  getAuthConfig,
  getApiConfig,

  // ADR-100: the request budgets (middlewares/requestBudget.middleware.ts)
  // count through the same store and its outage policy.
  storeIncr,
  storeIncrFixed,
  countsFailuresByIp,

  // Admin functions
  clearMemoryStore,
  sweepMemoryStore,
  memoryStoreStats,
};
