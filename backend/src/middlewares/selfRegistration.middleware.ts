/**
 * P10-12 (ADR-098 §8.3, Q-44) — `POST /auth/register` exists only where
 * self-registration is enabled (`config/publicAccess.ts#selfRegistrationEnabled`:
 * off in production unless `SELF_REGISTRATION_ENABLED=true`).
 *
 * Disabled, this skips the rest of the auth router (`next("router")`), so the
 * request falls through to the application's not-found handler and answers
 * exactly what a route that does not exist answers — 404 "Route not found" —
 * before any request budget is spent, any account is looked up, or anything is
 * written or mailed.
 */
import type { NextFunction, Request, Response } from "express";
import { selfRegistrationEnabled } from "../config/publicAccess";

export const selfRegistrationGate = (_req: Request, _res: Response, next: NextFunction): void => {
  if (selfRegistrationEnabled()) {
    next();
    return;
  }
  next("router");
};
