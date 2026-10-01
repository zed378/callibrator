/**
 * The API's CORS policy (moved out of index.js so it can be tested).
 *
 * Behaviour is what index.js had, with one change (DAST 2026-09-29): a
 * rejected origin used to be `callback(new Error("Not allowed by CORS"))`, a
 * plain Error the global handler answered with **500**. It is now an
 * AppError(403) — a clean refusal. Either way the `cors` package sets no
 * Access-Control-Allow-Origin on a rejected origin, so the browser still
 * blocks the response.
 */

import cors from "cors";
import type { RequestHandler } from "express";
import { env, isProduction } from "../config/env";
import { AppError } from "../utils/appError.util";
import { logger } from "./activityLog.middleware";

/** What a rejected origin is told. */
export const CORS_REJECTED_MESSAGE = "Origin not allowed by the CORS policy";

type OriginCallback = (err: Error | null, allow?: boolean) => void;

/** `CORS_ORIGIN`, comma-separated, trimmed; empty when unset. */
export const configuredOrigins = (): string[] => {
  const raw = env("CORS_ORIGIN");
  return raw ? raw.split(",").map((o) => o.trim()) : [];
};

/**
 * The origin decision.
 *
 * @param allowedOrigins - the explicit allow-list
 * @returns the `origin` option for the `cors` package
 */
export const corsOriginCheck = (
  allowedOrigins: readonly string[],
): ((origin: string | undefined, callback: OriginCallback) => void) => {
  return (origin: string | undefined, callback: OriginCallback): void => {
    // Allow server-to-server / Postman requests (no origin header)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Strict: only allow explicitly configured origins. A wildcard "*" is
    // intentionally NOT honored here — this CORS policy runs with
    // credentials:true, and reflecting an arbitrary origin back with
    // credentials would let any site make authenticated cross-origin
    // requests. Configure explicit origins instead.
    if (allowedOrigins.includes(origin.trim())) {
      callback(null, true);
      return;
    }

    if (isProduction()) {
      if (allowedOrigins.length === 0) {
        logger.warn("CORS error: origin rejected — no CORS_ORIGIN configured in production", { origin });
      }
      callback(new AppError(403, CORS_REJECTED_MESSAGE));
      return;
    }

    // Development default: allow all
    callback(null, true);
  };
};

/**
 * The CORS middleware the API mounts.
 *
 * @param allowedOrigins - defaults to `CORS_ORIGIN`, read now
 */
export const corsPolicy = (allowedOrigins: readonly string[] = configuredOrigins()): RequestHandler =>
  cors({
    origin: corsOriginCheck(allowedOrigins),
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
    optionsSuccessStatus: 200,
  });
