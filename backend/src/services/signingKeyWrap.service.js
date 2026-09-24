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
 */
const crypto = require("crypto");
const kms = require("./kms.service");
const { splitKeyList } = require("../utils/keyring.util");

/** The CBC keys a legacy row may be under: sha256 of each configured secret. */
const LEGACY_KEYS = [process.env.ENCRYPT_KEY, ...splitKeyList(process.env.ENCRYPT_KEY_PREVIOUS)]
  .filter(Boolean)
  .map((secret) => crypto.createHash("sha256").update(secret).digest());

/**
 * @param {string} stored - a tenant_keys.private_key value
 * @returns {boolean} true when it is the pre-P6-10 CBC form
 */
const isLegacy = (stored) => !kms.isEnvelope(stored);

/**
 * @param {string} stored - `ivHex:cipherHex`
 * @param {Buffer} key
 * @returns {string|null} the PEM, or null when this key does not open it
 */
const tryLegacyKey = (stored, key) => {
  try {
    const [ivHex, encrypted] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
    const pem = decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
    crypto.createPrivateKey(pem); // throws unless it really is a private key
    return pem;
  } catch {
    return null;
  }
};

/**
 * @param {string} stored - a legacy value
 * @returns {string} the PEM
 * @throws {Error} when no configured ENCRYPT_KEY opens it
 */
const unwrapLegacy = (stored) => {
  for (const key of LEGACY_KEYS) {
    const pem = tryLegacyKey(stored, key);
    if (pem !== null) {
      return pem;
    }
  }
  throw new Error(
    LEGACY_KEYS.length === 0
      ? "a legacy (AES-CBC) signing key cannot be read: ENCRYPT_KEY is not set"
      : `no configured ENCRYPT_KEY (${LEGACY_KEYS.length} tried) decrypts this legacy signing key`,
  );
};

/**
 * @param {string} tenantId - the AAD: the key reads back only for this tenant
 * @param {string} pem - the private key
 * @returns {string} a v2 envelope under the current KMS master key
 */
const wrapPrivateKey = (tenantId, pem) => kms.encryptData(tenantId, pem);

/**
 * @param {string} tenantId
 * @param {string} stored - an envelope, or the legacy CBC form
 * @returns {string} the PEM
 */
const unwrapPrivateKey = (tenantId, stored) =>
  isLegacy(stored) ? unwrapLegacy(stored) : kms.decryptData(tenantId, stored);

/**
 * Wrap a legacy CBC value as a legacy value: the ROLLBACK direction of
 * migration 0058 only. Never used to store a new key.
 *
 * @param {string} pem
 * @returns {string} `ivHex:cipherHex` under the first ENCRYPT_KEY
 * @throws {Error} when ENCRYPT_KEY is not set
 */
const wrapLegacy = (pem) => {
  if (LEGACY_KEYS.length === 0) {
    throw new Error("cannot restore the legacy form: ENCRYPT_KEY is not set");
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", LEGACY_KEYS[0], iv);
  return `${iv.toString("hex")}:${cipher.update(pem, "utf8", "hex")}${cipher.final("hex")}`;
};

module.exports = { wrapPrivateKey, unwrapPrivateKey, isLegacy, wrapLegacy };
