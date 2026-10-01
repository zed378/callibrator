/**
 * Types for `src/services/rateLimiter.redis.service.js`, which is still
 * JavaScript (P9-12, ADR-087 Amendment 13; the `config/index.d.ts` precedent).
 * It emits nothing and is never copied into `dist/`. It declares exactly what
 * the module exports (`module.exports = {...}`); `tests/guards/declarationDrift`
 * holds it to the module. It is deleted when the module converts.
 *
 * Members a converted TypeScript module calls are typed from the code. The
 * others are `(...args: never[]) => unknown`: callable only once someone types
 * them — the first TypeScript caller writes the type.
 */

/** Not yet typed: the first TypeScript caller types it. */
type Untyped = (...args: never[]) => unknown;

/** A password sign-in attempt, as the A-185 throttle keys it. */
interface LoginAttempt {
  identifier: string;
  ip?: string | null;
}

/** Who a lockout counter is kept for, and on which endpoint key. */
interface LockoutKey {
  userId?: string | null;
  tokenHash?: string | null;
  ip?: string | null;
  alsoByIp?: boolean;
  endpoint: string;
}

declare const rateLimiter: {
  /** A-260: whether a signed-in password check may run now. */
  checkPasswordCheckBudget: (userId: string) => Promise<{ throttled: boolean; retryAfterSeconds: number }>;
  /** A-260: count a failed signed-in password check. */
  recordPasswordCheckFailure: (
    userId: string,
  ) => Promise<{ engaged: boolean; exhausted: boolean; failedAttempts: number; pausedUntil: Date; retryAfterSeconds: number }>;
  /** A-260: forget the counter after a correct password. */
  clearPasswordCheckBudget: (userId: string) => Promise<void>;
  /** A-185: whether a password sign-in for this identifier (and address) is paused. */
  checkLoginThrottle: (attempt: LoginAttempt) => Promise<{ throttled: boolean; retryAfterSeconds: number }>;
  /** A-185: count a failed password sign-in. */
  recordLoginFailure: (
    attempt: LoginAttempt,
  ) => Promise<{ engaged: null | "identifier+address" | "identifier"; failedAttempts: number; pausedUntil: Date | null }>;
  /** A-185: forget the counters after a successful sign-in. */
  clearLoginThrottle: (attempt: LoginAttempt) => Promise<void>;
  loginIdentifierHash: Untyped;
  /** Count a failure against `endpoint`; locks once the endpoint's budget is spent. */
  recordAuthFailure: (params: LockoutKey & { audit?: { ipAddress?: string | null; userAgent?: string | null } }) => Promise<{
    allowed: boolean;
    remainingAttempts?: number;
    lockoutUntil?: Date | null;
    lockoutReason?: string | null;
    revokedToken?: boolean;
  }>;
  /** Whether `endpoint`'s budget for this key is spent. */
  checkAuthLockout: (params: LockoutKey) => Promise<{ locked: boolean; lockoutUntil?: Date; reason?: string }>;
  resetAuthFailures: Untyped;
  endpointRateLimiter: Untyped;
  getRateLimitStatus: Untyped;
  clearUserRateLimits: Untyped;
  revokeTokenByHash: Untyped;
  revokeAllUserTokens: Untyped;
  isTokenBlocked: Untyped;
  isUserLockedOut: Untyped;
  authPreCheck: Untyped;
  mfaLoginPreCheck: Untyped;
  mfaManagePreCheck: Untyped;
  noteAuthFailure: Untyped;
  noteAuthSuccess: Untyped;
  getAuthConfig: Untyped;
  getApiConfig: Untyped;
  /** ADR-100: add one to a counter (atomic, windowed); the new count. */
  storeIncr: (key: string, ttlMs: number) => Promise<number>;
  /** ADR-100: milliseconds left on a counter's window, or `fallbackMs`. */
  storeTtl: (key: string, fallbackMs: number) => Promise<number>;
  /** ADR-100: whether failures are also counted per client address. */
  countsFailuresByIp: () => boolean;
  clearMemoryStore: Untyped;
  sweepMemoryStore: Untyped;
  memoryStoreStats: Untyped;
};

export = rateLimiter;
