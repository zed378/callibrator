/**
 * P21-08 (ADR-138 § 6, Am. 1 § 9): the public device page carries its capability token in the PATH
 * (`/api/v1/public/devices/<token>`). A log keeps `~` and the first 8 hex characters of the token's
 * SHA-256 — enough to correlate a sticker's requests, never the token. Used by the activity log
 * (`sanitizeUrl`) and the access log (`:safe-url`). No dependency beyond `crypto`, so the access
 * log loads it without the winston logger.
 *
 * Named exports only.
 */
import { createHash } from "crypto";

const PUBLIC_DEVICE_PATH = /(\/public\/devices\/)([^/?#]+)/;

/**
 * @param url - a request URL about to be logged
 * @returns the URL with the public device token replaced by its hash prefix
 */
export const redactPublicDevicePath = (url: string): string =>
  url.replace(PUBLIC_DEVICE_PATH, (match: string, prefix: string, token: string) => {
    // Already redacted (`~` is outside the token's base64url alphabet): a log line sanitised twice keeps its prefix.
    if (token.startsWith("~")) {
      return match;
    }
    let raw = token;
    try {
      raw = decodeURIComponent(token);
    } catch {
      /* hash the raw segment */
    }
    return `${prefix}~${createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 8)}`;
  });
