/**
 * Q-53 (ADR-109 §6) — the global limiter's 429 speaks the house envelope.
 *
 * index.js's `defaultLimiter` (express-rate-limit, every route) answered
 * `{ status: "Error", message }` — the one error body outside
 * `{ success, status, message, data }`, so a client that reads `success` or a
 * numeric `status` misread it. The body is now the envelope, plus
 * `retryAfter` in seconds, the same shape as the per-route request budgets
 * (requestBudget.middleware.ts, ADR-100). `message` keeps its key and text.
 *
 * express-rate-limit sets `Retry-After` itself before calling `message` (it
 * does so whenever standard or legacy headers are on); this body repeats that
 * value so a client need not parse the header.
 */
import type { Request, Response } from "express";

/** The text the global limiter has always answered with. */
export const GLOBAL_LIMIT_MESSAGE = "Too many requests, please try again later";

/** The 429 body. */
export interface GlobalLimitBody {
  success: false;
  status: 429;
  message: string;
  data: null;
  /** Seconds until the window resets (the `Retry-After` header), or null if unknown. */
  retryAfter: number | null;
}

/**
 * express-rate-limit's `message` option (called as `message(req, res)`).
 *
 * @param _req - the refused request
 * @param res - its response; `Retry-After` is already set on it
 * @returns the envelope
 */
export const globalLimitBody = (_req: Request, res: Response): GlobalLimitBody => {
  const header = Number(res.getHeader("Retry-After"));
  return {
    success: false,
    status: 429,
    message: GLOBAL_LIMIT_MESSAGE,
    data: null,
    retryAfter: Number.isFinite(header) && header > 0 ? header : null,
  };
};
