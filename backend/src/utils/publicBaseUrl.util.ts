// src/utils/publicBaseUrl.util.ts
//
// P9-09 (ADR-087 Amendment 6): converted from publicBaseUrl.util.js with no
// behaviour change. The environment is read through src/config/env (at call
// time, as before); AppError and the logger are captured at load, as the
// destructuring requires were.
import type { Request } from "express";
import { AppError as AppErrorClass } from "./appError.util";
import { logger as activityLogger } from "../middlewares/activityLog.middleware";
import { envOr, isProduction } from "../config/env";

const AppError = AppErrorClass;
const logger = activityLogger;

/**
 * The origin a link the backend hands OUT must use — the one a browser, a
 * scanned QR code or an emailed link can reach (A-189, ADR-056).
 *
 * `baseUrlOf(req)` was `${req.protocol}://${req.get("host")}` in two
 * controllers. Behind the Next catch-all proxy the Host header is the one
 * Next's own fetch sets — `backend:3000` — so a certificate's verification
 * link, and an attachment's signed URL, pointed at a container name no
 * browser can resolve. And because the request-derived value was passed in,
 * it also beat PUBLIC_BASE_URL in certificatePdf.service#resolveVerifyUrl and
 * attachment.service#generateSignedUrl (`baseUrl || PUBLIC_BASE_URL`), so
 * configuring that variable never helped.
 *
 * The decision:
 *  1. A configured origin always wins: PUBLIC_BASE_URL, else HOST_URL (the
 *     public web origin every deploy config already sets — email branding
 *     uses it, docs/BACKEND/11-CONFIGURATION.md).
 *  2. In PRODUCTION there is no fallback: a link printed into a certificate
 *     PDF (which is cached and re-served) must not be built from anything a
 *     client can influence. With neither set, the request fails with a 500
 *     that names the missing setting, rather than issue a wrong link.
 *  3. Outside production (a developer's machine) the request's own origin is
 *     used, as Express resolves it: `req.protocol` and `req.host` read
 *     X-Forwarded-Proto / X-Forwarded-Host only from the one trusted hop
 *     (TRUST_PROXY_HOPS, ADR-050) — the Next proxy, which now overwrites both
 *     from the request it received (frontend app/api/v1/[...path]/route.ts).
 *
 * @param req - the request
 * @returns an origin with no trailing slash
 * @throws AppError 500 in production when no public origin is configured
 */
const baseUrlOf = (req: Request): string => {
  // `PUBLIC_BASE_URL || HOST_URL || ""`: each unset-or-empty falls through.
  const configured = envOr("PUBLIC_BASE_URL", envOr("HOST_URL", "")).trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  if (isProduction()) {
    logger.error("No public base URL is configured: set PUBLIC_BASE_URL or HOST_URL");
    throw new AppError(500, "Server misconfiguration: the public base URL (PUBLIC_BASE_URL or HOST_URL) is not set");
  }
  return `${req.protocol}://${req.host}`;
};

export { baseUrlOf };
