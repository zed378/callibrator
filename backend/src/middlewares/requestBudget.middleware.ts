// src/middlewares/requestBudget.middleware.ts
//
// ADR-100 (A-291, A-292, A-293) — REQUEST budgets for the public endpoints.
//
// The auth failure throttles (AUTH_ENDPOINTS, authPreCheck) count FAILURES:
// a registration, an OTP request or an SSO start that SUCCEEDS was never
// counted, so each could be repeated without bound — a mail cannon aimed at
// any address, and an unthrottled tenant-code probe. `authLimiter` and
// `otpLimiter` in index.js were declared for this and never mounted (ADR-088);
// they were per-process express-rate-limit stores, which ignore the shared
// Redis counters and their outage policy, and were removed.
//
// A budget counts EVERY request, success or failure, under one or more keys:
//   - the client address (req.ip — A-16), unless `perAddress: false`;
//   - an optional key the endpoint derives from the request (`keyOf`), e.g.
//     the hashed address an OTP is mailed to. The derived key is counted
//     whether or not it names an account, so the 429 is not an oracle.
// Counting goes through rateLimiter.redis.service's store: Redis, and on an
// outage the bounded in-memory fallback — never skipped (its OUTAGE POLICY).
//
// The limits in API_ENDPOINTS are PRODUCTION limits. Outside production they
// are multiplied by RATE_LIMIT_NON_PRODUCTION_FACTOR (default 100), for the
// reason defaultLimiter is raised there: one E2E run signs in hundreds of
// times from 127.0.0.1. A test sets the factor to 1.
//
// A 429 is the error envelope `{ success: false, status: 429, message,
// data: null, retryAfter }` with a Retry-After header, and names no key.
import * as crypto from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getApiConfig, makeKey } from "../constants/rateLimitConstants";
import { envOr, isProduction } from "../config/env";
import { logger } from "./activityLog.middleware";
import * as rateLimiter from "../services/rateLimiter.redis.service";

/** What a budget can be told beyond its API_ENDPOINTS entry. */
export interface RequestBudgetOptions {
  /** Count the client address (default true). */
  perAddress?: boolean;
  /** A further key from the request, or null to skip it for this request. */
  keyOf?: (req: Request) => string | null;
}

/** Outside production the limits are multiplied by this (default 100). */
export const nonProductionFactor = (): number => {
  const factor = Number(envOr("RATE_LIMIT_NON_PRODUCTION_FACTOR", "100"));
  return Number.isFinite(factor) && factor >= 1 ? factor : 100;
};

/** The limit in force for an API_ENDPOINTS entry, now. */
export const effectiveLimit = (maxRequests: number): number =>
  isProduction() ? maxRequests : maxRequests * nonProductionFactor();

/**
 * A key for a value a caller typed (an email address): trimmed, lower-cased
 * and hashed, so the store never holds it in the clear.
 */
export const hashedKey = (value: string): string =>
  crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

/** The client address, as the rate limiter derives it (never a raw header). */
const clientAddress = (req: Request): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty req.ip falls through, as rateLimiter.redis.service#clientAddress
  req.ip || req.socket.remoteAddress || "unknown";

/**
 * A middleware that counts every request against `endpointKey`'s budget.
 *
 * @param endpointKey - an API_ENDPOINTS key
 * @param options - which keys to count
 */
export const requestBudget = (endpointKey: string, options: RequestBudgetOptions = {}): RequestHandler => {
  const { perAddress = true, keyOf } = options;
  const config = getApiConfig(endpointKey);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const keys: string[] = [];
      if (perAddress) {
        keys.push(makeKey("budget", endpointKey, `ip:${clientAddress(req)}`));
      }
      const derived = keyOf ? keyOf(req) : null;
      if (derived) {
        keys.push(makeKey("budget", endpointKey, `key:${derived}`));
      }
      const limit = effectiveLimit(config.maxRequests);
      for (const key of keys) {
        // ADR-100 Amendment 5: a FIXED window. A refused request is counted
        // but never extends it, so the budget recovers exactly when the
        // Retry-After below says — a retrying client or a NAT is not locked out
        // for as long as it keeps trying.
        const { count, expiresAt } = await rateLimiter.storeIncrFixed(key, config.windowMs);
        if (count > limit) {
          const retryAfter = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
          res.setHeader("Retry-After", String(retryAfter));
          res.status(429).json({
            success: false,
            status: 429,
            message: `Too many requests. ${config.description} is paused for this caller; try again in ${String(retryAfter)} seconds.`,
            data: null,
            retryAfter,
          });
          return;
        }
      }
      next();
    } catch (err) {
      // The store handles its own Redis faults (memory fallback); only a
      // programming error reaches here. Logged, and the request proceeds, as
      // endpointRateLimiter does.
      logger.error(`Request budget error on ${endpointKey}: ${err instanceof Error ? err.message : String(err)}`);
      next();
    }
  };
};
