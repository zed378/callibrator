/**
 * Q-42 (ADR-113) — `POST /access-requests` exists only once the privacy notice
 * its consent refers to is published (`config/publicAccess.ts#privacyNoticeUrl`,
 * `PRIVACY_NOTICE_URL`).
 *
 * Unset, this skips the rest of the intake router (`next("router")`), so the
 * request falls through to the application's not-found handler and answers
 * exactly what a route that does not exist answers — 404 "Route not found" —
 * before any request budget is spent, anything is validated, stored or mailed.
 * One answer for every body: no oracle. The same shape as the self-registration
 * gate (P10-12).
 */
import type { NextFunction, Request, Response } from "express";
import { privacyNoticeUrl } from "../config/publicAccess";

export const accessRequestIntakeGate = (_req: Request, _res: Response, next: NextFunction): void => {
  if (privacyNoticeUrl() !== null) {
    next();
    return;
  }
  next("router");
};
