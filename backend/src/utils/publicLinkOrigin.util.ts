// src/utils/publicLinkOrigin.util.ts
//
// A-289 (ADR-100) — the origin an EMAILED link to a front-end page is built on.
//
// The activation link was `req.headers.origin || req.headers.host` +
// "/activation?token=…": a caller who forged `Origin` had our mailer send a
// genuine activation token, on the attacker's domain, to a real address (link
// poisoning). The origin now comes from configuration only — FRONTEND_URL,
// else HOST_URL, the order every other emailed link already uses (A-171:
// e-signature, custom-domain verification, GDPR) — and never from a request.
//
// In production an unset origin is a refusal, BEFORE anything is written or
// sent: a registration that cannot send a correct link must not create the
// account and mail nothing (or mail a wrong link). Outside production the
// developer's front end, http://localhost:3000, is the fallback.
import { AppError } from "./appError.util";
import { envOr, isProduction } from "../config/env";

/** The fallback outside production: the Next dev server. */
export const DEVELOPMENT_FRONTEND_ORIGIN = "http://localhost:3000";

/**
 * The configured public front-end origin, with no trailing slash, or null.
 *
 * @returns FRONTEND_URL, else HOST_URL, else null (unset or blank)
 */
export const configuredFrontendOrigin = (): string | null => {
  const value = envOr("FRONTEND_URL", envOr("HOST_URL", "")).trim().replace(/\/+$/, "");
  return value === "" ? null : value;
};

/**
 * The origin for an emailed front-end link.
 *
 * @returns the configured origin; outside production, the dev server when unset
 * @throws AppError 500 in production when neither FRONTEND_URL nor HOST_URL is set
 */
export const emailLinkOrigin = (): string => {
  const configured = configuredFrontendOrigin();
  if (configured) {
    return configured;
  }
  if (isProduction()) {
    throw new AppError(
      500,
      "Server misconfiguration: the public front-end URL (FRONTEND_URL or HOST_URL) is not set, so no email link can be sent",
    );
  }
  return DEVELOPMENT_FRONTEND_ORIGIN;
};
