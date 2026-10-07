/**
 * The lifetime of a signed download link (A-365, F-1 of
 * docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 9).
 *
 * A signed link is a bearer capability: whoever holds the URL downloads the
 * file without signing in. Until A-365 the caller chose its lifetime with no
 * upper bound (`POST /attachments/:id/signed-url { expiresInSec }`), so a
 * tenant user could mint a link valid for years that outlived its own account.
 * The lifetime is now bounded on both sides:
 *
 *   SIGNED_URL_MIN_TTL_SEC        30 s   — below this a link expires before a
 *                                          slow client has followed it.
 *   ATTACHMENT_URL_MAX_TTL_SEC    900 s  — the operator's cap (default 15 min),
 *                                          clamped into [30, 3600].
 *   SIGNED_URL_HARD_MAX_TTL_SEC   3600 s — no configuration can exceed one hour.
 *   ATTACHMENT_URL_TTL_SEC        300 s  — the lifetime when the caller names
 *                                          none, clamped into [30, the cap].
 *
 * A value that is not a positive integer falls back to its default rather than
 * refusing the boot: the bound, not the exact figure, is the security
 * property, and both fallbacks sit inside it.
 *
 * Read at CALL time (config/env.ts): tests and the boot set variables after
 * this module loads.
 */
import { env } from "./env";

/** The shortest lifetime a caller may ask for, in seconds. */
export const SIGNED_URL_MIN_TTL_SEC = 30;

/** The longest lifetime any configuration may allow, in seconds. */
export const SIGNED_URL_HARD_MAX_TTL_SEC = 3600;

/** The cap when ATTACHMENT_URL_MAX_TTL_SEC is unset or invalid (15 minutes). */
export const SIGNED_URL_DEFAULT_MAX_TTL_SEC = 900;

/** The lifetime when ATTACHMENT_URL_TTL_SEC is unset or invalid (5 minutes). */
export const SIGNED_URL_DEFAULT_TTL_SEC = 300;

/** A positive integer read from `name`, or `fallback`. */
const positiveIntOr = (name: string, fallback: number): number => {
  const value = Number(env(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** The configured cap on a signed link's lifetime, in seconds. */
export const signedUrlMaxTtlSec = (): number =>
  clamp(positiveIntOr("ATTACHMENT_URL_MAX_TTL_SEC", SIGNED_URL_DEFAULT_MAX_TTL_SEC), SIGNED_URL_MIN_TTL_SEC, SIGNED_URL_HARD_MAX_TTL_SEC);

/** The lifetime of a link whose caller names none, in seconds — never above the cap. */
export const signedUrlDefaultTtlSec = (): number =>
  clamp(positiveIntOr("ATTACHMENT_URL_TTL_SEC", SIGNED_URL_DEFAULT_TTL_SEC), SIGNED_URL_MIN_TTL_SEC, signedUrlMaxTtlSec());

/**
 * Whether `ttl` is a lifetime a caller may ask for: an integer in
 * [SIGNED_URL_MIN_TTL_SEC, the configured cap].
 */
export const isAllowedSignedUrlTtl = (ttl: unknown): ttl is number =>
  typeof ttl === "number" && Number.isInteger(ttl) && ttl >= SIGNED_URL_MIN_TTL_SEC && ttl <= signedUrlMaxTtlSec();

/**
 * The lifetime a storage-layer link gets (ScopedStorage#signedUrl): the default
 * when none is named, otherwise the named one clamped into the allowed range.
 * The storage layer clamps instead of refusing because it has no request to
 * answer 400 to; the attachment route refuses (validators/attachment.validator).
 */
export const boundedSignedUrlTtlSec = (ttl: unknown): number => {
  const value = Number(ttl);
  if (ttl === undefined || ttl === null || !Number.isFinite(value) || value <= 0) {
    return signedUrlDefaultTtlSec();
  }
  return clamp(Math.floor(value), SIGNED_URL_MIN_TTL_SEC, signedUrlMaxTtlSec());
};
