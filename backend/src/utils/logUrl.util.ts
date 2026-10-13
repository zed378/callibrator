/**
 * A URL as a log line may carry it (A-14, A-228; ADR-138 Am. 2 § 3 and Am. 5): the public device
 * page's path token hashed (publicDevicePath.util), and every query value that is — or looks like —
 * a credential replaced by `[REDACTED]`. Shared by the activity log (`sanitizeUrl`) and the access
 * log (`:safe-url`, `:safe-referrer`), so both write the same URL. No dependency beyond `crypto`
 * (through publicDevicePath.util): the access log loads it without the winston logger.
 *
 * A query value is redacted when its KEY is sensitive — the log's key list (`token`, `secret`,
 * `password`, `…link`, …), a one-time code's key (`code`, `pin`), the OAuth `state`, or a short key
 * that names a capability (`t`, `k`, `sig`, `signature`, `hmac`, `nonce`, `ticket`, `key`, `auth`,
 * `jwt`) — or when its VALUE looks like one whatever the key: 24 or more base64url / hex characters,
 * with both a letter and a digit, that are not a UUID (record ids stay readable). The verification
 * links (`?token=`, `?t=`), invitations and activations are covered by both rules.
 *
 * Named exports only.
 */
import { redactPublicDevicePath } from "./publicDevicePath.util";

/** What a redacted value is written as. */
export const REDACTED = "[REDACTED]";

/**
 * Key names whose value is never logged, matched at any depth after lower-casing and removing `-` and
 * `_` (so `set-cookie`, `api_key`, `x-api-key`, `refreshToken` and `mfa_secret` all match).
 * A-228 — `link$`: a generated link carries its capability token in the URL, so the whole value is a
 * credential.
 */
export const SENSITIVE_KEY =
  /password|passwd|passphrase|^pass$|secret|token|authorization|cookie|apikey|privatekey|publickey|masterkey|encryptionkey|credential|^otp|otp$|^totp|mfacode|recoverycode|backupcode|sessionid|^sid$|link$/;

/** A one-time code under a generic key (`code`, `pin`). */
export const CODE_KEY = /^(code|pin|verificationcode)$/;

/** Short query keys that name a capability (`?t=` of the printed verification links). */
const CAPABILITY_KEY = /^(t|k|sig|signature|hmac|nonce|ticket|key|auth|jwt|state)$/;

/** A value that looks like a capability token: 24+ base64url / hex characters (optional padding). */
const TOKEN_VALUE = /^[A-Za-z0-9_-]{24,}={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A key as JavaScript callers may pass it: any property key. */
export type LogKey = PropertyKey;

/** A key lower-cased without `-` and `_`. */
export const normaliseKey = (key: LogKey): string => String(key).toLowerCase().replace(/[-_]/g, "");

/** Whether a key's value is never logged. */
export const isSensitiveKey = (key: LogKey): boolean => SENSITIVE_KEY.test(normaliseKey(key));

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
};

/** Whether a (decoded) query value looks like a capability token. */
export const looksLikeToken = (value: string): boolean => TOKEN_VALUE.test(value) && !UUID.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);

/** Whether a query parameter's value is redacted. */
const redactedParameter = (rawKey: string, rawValue: string): boolean => {
  const key = decoded(rawKey);
  const normalised = normaliseKey(key);
  return isSensitiveKey(key) || CODE_KEY.test(normalised) || CAPABILITY_KEY.test(normalised) || looksLikeToken(decoded(rawValue));
};

/**
 * @param url - a request URL (or a Referer) about to be logged
 * @returns the URL with the public device token hashed and every credential-like query value redacted
 */
export const redactUrlForLog = (url: string): string => {
  const path = redactPublicDevicePath(url);
  const q = path.indexOf("?");
  if (q === -1) {
    return path;
  }
  const query = path
    .slice(q + 1)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) {
        return looksLikeToken(decoded(pair)) ? REDACTED : pair;
      }
      return redactedParameter(pair.slice(0, eq), pair.slice(eq + 1)) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
    })
    .join("&");
  return `${path.slice(0, q)}?${query}`;
};
