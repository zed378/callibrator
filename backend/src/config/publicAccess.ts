/**
 * Phase 10 (ADR-098) — configuration of the public ways in: self-registration,
 * the access-request intake and the invitation link.
 *
 * Read through `env.ts` at CALL time (tests and the boot sequence set
 * variables after load). The access-request variables are documented in
 * `.env.example`.
 */
import { env, isProduction } from "./env";

/** A variable's trimmed value, or null when unset or blank. */
const trimmed = (name: string): string | null => {
  const value = (env(name) ?? "").trim();
  return value === "" ? null : value;
};

/**
 * P10-12 (Q-44, working decision) — whether `POST /auth/register` exists.
 *
 * `SELF_REGISTRATION_ENABLED=true|false` decides; unset (or any other value)
 * means OFF in production and ON elsewhere. Off, the route behaves as absent
 * (404, the standard not-found envelope) and writes and mails nothing:
 * Request access (P10-05) is the way in.
 */
export const selfRegistrationEnabled = (): boolean => {
  const value = (trimmed("SELF_REGISTRATION_ENABLED") ?? "").toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return !isProduction();
};

/**
 * P10-05 — the internal inbox told that a new access request arrived, or null
 * (then no notification is queued; the queue page is the source of truth).
 */
export const accessRequestNotifyEmail = (): string | null => trimmed("ACCESS_REQUEST_NOTIFY_EMAIL");

/**
 * Q-42 (decision 2026-10-01, ADR-113) — the published privacy notice the
 * access-request form's consent refers to, or null.
 *
 * A form collecting personal data does not open before its notice exists:
 * while this is null the public intake behaves as ABSENT
 * (`accessRequestIntakeGate`: 404, the standard not-found envelope), in every
 * environment. Only an absolute http(s) URL counts; anything else reads as
 * unset, so a typo closes the intake rather than linking to nothing. The
 * frontend reads the same variable (`components/public/privacyNotice.ts`).
 */
export const privacyNoticeUrl = (): string | null => {
  const value = trimmed("PRIVACY_NOTICE_URL");
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** The pepper used outside production when none is set. Never a secret. */
export const DEVELOPMENT_IP_PEPPER = "development-only-access-request-pepper";

/**
 * P10-05 — the secret mixed into the hashed client address stored with an
 * access request (`sha256(pepper + ip)`; the raw address is never stored).
 * Required in production: `assertPublicAccessConfig` refuses the boot without
 * it. Elsewhere a fixed development value stands in.
 */
export const accessRequestIpPepper = (): string => {
  const value = trimmed("ACCESS_REQUEST_IP_PEPPER");
  if (value !== null) {
    return value;
  }
  if (isProduction()) {
    throw new Error("ACCESS_REQUEST_IP_PEPPER is required in production (P10-05)");
  }
  return DEVELOPMENT_IP_PEPPER;
};

/**
 * Refuse to start in production without what the public intake needs. Called
 * when the access-request route module loads, which `index.js` does at boot.
 */
export const assertPublicAccessConfig = (): void => {
  accessRequestIpPepper();
};
