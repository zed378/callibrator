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
 *
 * P9-09 (ADR-087): converted from auditRedaction.util.js with no behaviour
 * change. The walked value is `unknown`: `changes` is whatever a service
 * recorded.
 */

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 10;

const SECRET_KEY =
  /(password|passwd|passphrase|secret|token|apikey|accesskey|secretkey|privatekey|masterkey|encryptionkey|signingkey|credential|credentials|authorization|cookie|otp|otpcode|mfacode|recoverycode|recoverycodes|backupcode|backupcodes)(hash)?$/;

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

/** A redacted copy of an audit row's `changes`, and what was redacted. */
export interface RedactionResult {
  value: unknown;
  /** the dotted paths that were redacted */
  redacted: string[];
}

/** An object that may carry its own `toJSON`, as a Sequelize instance or a Date does. */
interface MaybeSerialisable {
  toJSON?: () => unknown;
}

/**
 * @returns whether a value under this key is a secret
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as-built (ADR-038 rule 3): JavaScript callers may pass a non-string
const isSecretKey = (key: string): boolean => SECRET_KEY.test(String(key).toLowerCase().replace(/[-_]/g, ""));

const holdsValue = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "" && typeof value !== "boolean";

/**
 * A redacted copy of `changes`, and the dotted paths that were redacted.
 * Never mutates its input.
 *
 * @param changes - the audit row's `changes`
 */
const redactAuditChanges = (changes: unknown): RedactionResult => {
  const redacted: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (value: unknown, trail: string, depth: number): unknown => {
    if (typeof value === "string") {
      const scrubbed = value.replace(BEARER, `$1 ${REDACTED}`).replace(JWT, REDACTED);
      if (scrubbed !== value) {
        // `||`: the root value has an empty trail.
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
      return value.map((item: unknown, i) => walk(item, `${trail}[${String(i)}]`, depth + 1));
    }
    // Read and called exactly as before: `value.toJSON` twice, as a method.
    const serialisable = value as MaybeSerialisable;
    const source: unknown = typeof serialisable.toJSON === "function" ? serialisable.toJSON() : value;
    if (source === null || typeof source !== "object") {
      return source;
    }
    const entries = source as Readonly<Record<string, unknown>>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(entries)) {
      const path = trail ? `${trail}.${key}` : key;
      if (isSecretKey(key) && holdsValue(entries[key])) {
        out[key] = REDACTED;
        redacted.push(path);
      } else {
        out[key] = walk(entries[key], path, depth + 1);
      }
    }
    return out;
  };

  return { value: walk(changes, "", 0), redacted };
};

export { redactAuditChanges, isSecretKey, REDACTED };
