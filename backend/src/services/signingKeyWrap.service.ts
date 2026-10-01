/**
 * P6-10 / S-08 — how a tenant's e-signature PRIVATE key is stored.
 *
 * Before: AES-256-CBC under sha256(ENCRYPT_KEY), `ivHex:cipherHex` — no MAC
 * (malleable), no tenant binding, and a key outside the KMS with no key id,
 * so it could not be rotated. Those keys sign 21 CFR Part 11 records.
 *
 * Now: a kms.service envelope — AES-256-GCM (authenticated), the tenant id as
 * AAD (a row copied to another tenant does not decrypt), and a `v2:<keyId>`
 * prefix naming the master key, so it rotates with every other secret
 * (docs/SECURITY/13-KEY-ROTATION.md).
 *
 * The legacy form is still READ, so nothing breaks before migration 0058 has
 * re-wrapped a database, or on a row restored from an old backup: any of
 * ENCRYPT_KEY / ENCRYPT_KEY_PREVIOUS is tried, and a result is accepted only
 * if it parses as a private key (CBC has no MAC — a wrong key or a tampered
 * ciphertext can decrypt to bytes that merely look like success). Nothing is
 * ever WRITTEN in the legacy form, so ENCRYPT_KEY can be retired once no
 * legacy row remains (`npm run keys:rotate -- --dry-run` reports them).
 *
 * P9-18 (ADR-087, Stage C; converted under the four isolation gates): from
 * signingKeyWrap.service.js with no behaviour change. `export =` keeps the
 * exact object `require()` returned (the same keys, in the same order).
 * `crypto` and `kms` are the module objects, read at call time (a spy on
 * `kms.encryptData` still applies); `splitKeyList` is captured at load. The
 * legacy keys are still derived at LOAD from the environment, read through
 * src/config/env (P9-06).
 */
import crypto from "crypto";
import kms from "./kms.service";
import { splitKeyList as loadedSplitKeyList } from "../utils/keyring.util";
import { env } from "../config/env";

const splitKeyList = loadedSplitKeyList;

/** The CBC keys a legacy row may be under: sha256 of each configured secret. */
const LEGACY_KEYS = [env("ENCRYPT_KEY"), ...splitKeyList(env("ENCRYPT_KEY_PREVIOUS"))]
  .filter((secret): secret is string => Boolean(secret))
  .map((secret) => crypto.createHash("sha256").update(secret).digest());

/**
 * @param stored - a tenant_keys.private_key value
 * @returns true when it is the pre-P6-10 CBC form
 */
const isLegacy = (stored: unknown): boolean => !kms.isEnvelope(stored);

/**
 * @param stored - `ivHex:cipherHex`
 * @param key - one legacy key
 * @returns the PEM, or null when this key does not open it
 */
const tryLegacyKey = (stored: string, key: Buffer): string | null => {
  try {
    // As built: a malformed value throws inside this try and reads as "not this key".
    const [ivHex, encrypted] = stored.split(":") as [string, string];
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
    const pem = decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
    crypto.createPrivateKey(pem); // throws unless it really is a private key
    return pem;
  } catch {
    return null;
  }
};

/**
 * @param stored - a legacy value
 * @returns the PEM
 * @throws {Error} when no configured ENCRYPT_KEY opens it
 */
const unwrapLegacy = (stored: string): string => {
  for (const key of LEGACY_KEYS) {
    const pem = tryLegacyKey(stored, key);
    if (pem !== null) {
      return pem;
    }
  }
  throw new Error(
    LEGACY_KEYS.length === 0
      ? "a legacy (AES-CBC) signing key cannot be read: ENCRYPT_KEY is not set"
      : `no configured ENCRYPT_KEY (${String(LEGACY_KEYS.length)} tried) decrypts this legacy signing key`,
  );
};

/**
 * @param tenantId - the AAD: the key reads back only for this tenant
 * @param pem - the private key
 * @returns a v2 envelope under the current KMS master key
 */
const wrapPrivateKey = (tenantId: string, pem: string): string | null => kms.encryptData(tenantId, pem);

/**
 * @param tenantId - the AAD
 * @param stored - an envelope, or the legacy CBC form
 * @returns the PEM
 */
const unwrapPrivateKey = (tenantId: string, stored: string): string =>
  isLegacy(stored) ? unwrapLegacy(stored) : kms.decryptData(tenantId, stored);

/**
 * Wrap a legacy CBC value as a legacy value: the ROLLBACK direction of
 * migration 0058 only. Never used to store a new key.
 *
 * @param pem - the private key
 * @returns `ivHex:cipherHex` under the first ENCRYPT_KEY
 * @throws {Error} when ENCRYPT_KEY is not set
 */
const wrapLegacy = (pem: string): string => {
  if (LEGACY_KEYS.length === 0) {
    throw new Error("cannot restore the legacy form: ENCRYPT_KEY is not set");
  }
  const iv = crypto.randomBytes(16);
  // LEGACY_KEYS is not empty here, checked above.
  const cipher = crypto.createCipheriv("aes-256-cbc", LEGACY_KEYS[0] as Buffer, iv);
  return `${iv.toString("hex")}:${cipher.update(pem, "utf8", "hex")}${cipher.final("hex")}`;
};

export = { wrapPrivateKey, unwrapPrivateKey, isLegacy, wrapLegacy };
