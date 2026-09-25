/**
 * D-27 (ADR-070) — a deny-list of secret-bearing key names, applied to
 * `audit_logs.changes` at write time (audit.service#logAction).
 *
 * `audit_logs` is permanent — never purged (ADR-051 Q-12) — so a secret
 * written into `changes` is kept forever and read by every administrator who
 * can read the trail. A-228's log redaction covers log lines, not audit rows,
 * and is too broad for them: it masks every email address, and an audit row
 * must say exactly which address a change set.
 *
 * The rule is narrower on purpose:
 *  - a key is secret when its name, lower-cased with `-` and `_` removed, ENDS
 *    with a secret word (password, secret, token, apikey, privatekey, ...),
 *    optionally followed by `hash`. `password` and `smtp_password` and
 *    `tokenHash` are secret; `passwordChangedAt`, `tokenExpiresAt` and
 *    `secretRotated` are not — they describe a secret without holding it;
 *  - a boolean or empty value under a secret name is kept (`mustChangePassword:
 *    true` says nothing about the password);
 *  - any string that IS a bearer credential or a JWT is masked wherever it is.
 *
 * The row is still written, with the value replaced — refusing it would roll
 * back the mutation (logAction re-throws inside a transaction). The caller is
 * named in a warning so the call site gets fixed.
 */

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 10;

const SECRET_KEY =
  /(password|passwd|passphrase|secret|token|apikey|accesskey|secretkey|privatekey|masterkey|encryptionkey|signingkey|credential|credentials|authorization|cookie|otp|otpcode|mfacode|recoverycode|recoverycodes|backupcode|backupcodes)(hash)?$/;

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

/**
 * @param {string} key
 * @returns {boolean} whether a value under this key is a secret
 */
const isSecretKey = (key) => SECRET_KEY.test(String(key).toLowerCase().replace(/[-_]/g, ""));

const holdsValue = (value) => value !== null && value !== undefined && value !== "" && typeof value !== "boolean";

/**
 * A redacted copy of `changes`, and the dotted paths that were redacted.
 * Never mutates its input.
 *
 * @param {*} changes - the audit row's `changes`
 * @returns {{value: *, redacted: string[]}}
 */
const redactAuditChanges = (changes) => {
  const redacted = [];
  const seen = new WeakSet();

  const walk = (value, trail, depth) => {
    if (typeof value === "string") {
      const scrubbed = value.replace(BEARER, `$1 ${REDACTED}`).replace(JWT, REDACTED);
      if (scrubbed !== value) {
        redacted.push(trail || "(value)");
      }
      return scrubbed;
    }
    if (value === null || typeof value !== "object" || value instanceof Date) {
      return value;
    }
    if (seen.has(value) || depth >= MAX_DEPTH) {
      return value;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, `${trail}[${i}]`, depth + 1));
    }
    const source = typeof value.toJSON === "function" ? value.toJSON() : value;
    if (source === null || typeof source !== "object") {
      return source;
    }
    const out = {};
    for (const key of Object.keys(source)) {
      const path = trail ? `${trail}.${key}` : key;
      if (isSecretKey(key) && holdsValue(source[key])) {
        out[key] = REDACTED;
        redacted.push(path);
      } else {
        out[key] = walk(source[key], path, depth + 1);
      }
    }
    return out;
  };

  return { value: walk(changes, "", 0), redacted };
};

module.exports = { redactAuditChanges, isSecretKey, REDACTED };
