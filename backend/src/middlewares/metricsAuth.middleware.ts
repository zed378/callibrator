// P9-19 (ADR-087): converted from metricsAuth.middleware.js with no behaviour
// change. `crypto` is the module object itself (a default import), read at call
// time as before. METRICS_TOKEN is read per request through src/config/env's
// `envOr`, the same `process.env.METRICS_TOKEN || ""` expression (process.env
// holds only strings, so the .js's String() around it changed nothing).
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { envOr } from "../config/env";

/** A token shorter than this is refused as unset: it would be guessable. */
const MIN_TOKEN_LENGTH = 32;

const sha256 = (value: string): Buffer => crypto.createHash("sha256").update(value).digest();

/**
 * Gate for the metrics endpoint (P7-02): `Authorization: Bearer
 * <METRICS_TOKEN>`.
 *
 * A scraper (Prometheus, an uptime agent) has no user, so a session gate does
 * not fit and an API key would carry tenant permissions it must not have. A
 * single static operator token does.
 *
 * - METRICS_TOKEN unset, or shorter than 32 characters: 404, as if the route
 *   did not exist. Metrics are OFF until an operator turns them on.
 * - Wrong or missing token: 401.
 * - The comparison hashes both sides first, so it is constant-time and
 *   length-independent.
 */
// Returns what the .js returned (the Response, or next()'s result); Express ignores it.
const metricsAuth = (req: Request, res: Response, next: NextFunction): unknown => {
  // The .js wrapped this in String(); an environment value is already a string.
  const expected = envOr("METRICS_TOKEN", "");
  if (expected.length < MIN_TOKEN_LENGTH) {
    return res.status(404).json({ success: false, status: 404, message: "Not found", data: null });
  }
  // As built: String() stays, because a JavaScript caller can put a non-string
  // there; `||` stays, because an empty header is no header.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion -- as built (see above)
  const header = String(req.headers.authorization || "");
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!crypto.timingSafeEqual(sha256(presented), sha256(expected))) {
    return res.status(401).json({ success: false, status: 401, message: "Unauthorized", data: null });
  }
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: `return next()`
  return next();
};

export { metricsAuth, MIN_TOKEN_LENGTH };
