const crypto = require('crypto');
const { AppError } = require('../utils/appError.util');
const { logger } = require('../middlewares/activityLog.middleware');
const { buildKeyring, splitKeyList } = require('../utils/keyring.util');

// In production, this would be retrieved from AWS KMS, Azure Key Vault, etc.
// We use a local 32-byte hex master key for development only.
//
// SECURITY: refuse to boot in production with the well-known development master
// key. Otherwise every tenant secret (SSO cert, OIDC/Stripe/webhook secrets)
// would be protected by a key that is public in the source tree.
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.KMS_MASTER_KEY) {
  throw new Error(
    'KMS_MASTER_KEY must be set in production (64-char hex / 32-byte key). ' +
      'Refusing to start with the insecure development master key.',
  );
}

/**
 * @param {string} hex - a 64-character hex key
 * @param {string} name - the variable it came from, for the message
 * @returns {Buffer} 32 bytes
 */
const parseMasterKey = (hex, name) => {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `${name} must decode to 32 bytes (got ${key.length}); provide a 64-character hex string.`,
    );
  }
  return key;
};

// P6-10 / S-08 — a key RING, not one key. KMS_MASTER_KEY is the current key:
// every new envelope is wrapped under it and names it (v2). The keys in
// KMS_MASTER_KEY_PREVIOUS (comma-separated) are only ever read with, so a
// rotation is: new key current, old key previous, re-wrap (scripts/rotateKeys),
// then drop the old key. docs/SECURITY/13-KEY-ROTATION.md.
const MASTER_KEY_HEX = process.env.KMS_MASTER_KEY || crypto.createHash('sha256').update('local-kms-mock-key').digest('hex');
const RING = buildKeyring(
  parseMasterKey(MASTER_KEY_HEX, 'KMS_MASTER_KEY'),
  splitKeyList(process.env.KMS_MASTER_KEY_PREVIOUS).map((hex, i) =>
    parseMasterKey(hex, `KMS_MASTER_KEY_PREVIOUS[${i}]`),
  ),
);

/**
 * Envelope formats.
 *   v1:encDEK:dekIv:dekAuthTag:encData:dataIv:dataAuthTag         (7 parts)
 *   v2:keyId:encDEK:dekIv:dekAuthTag:encData:dataIv:dataAuthTag   (8 parts)
 * v1 names no key: it is read by trying each key of the ring (the DEK is
 * GCM-wrapped, so only the right key authenticates). Every new envelope is v2.
 */
const ENVELOPE_PATTERN = /^v[12]:/;

/**
 * @param {*} value
 * @returns {boolean} true when `value` is a kms.service envelope (any version)
 */
exports.isEnvelope = (value) => typeof value === 'string' && ENVELOPE_PATTERN.test(value);

/**
 * Encrypt a Data Encryption Key (DEK) with the CURRENT master key
 */
const encryptDEK = (dekBuffer) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', RING.current, iv);

  const encryptedDEK = Buffer.concat([cipher.update(dekBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedDEK: encryptedDEK.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
};

/**
 * Unwrap a DEK with one master key.
 */
const unwrapDEK = (masterKey, encryptedDEK64, iv64, authTag64) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedDEK64, 'base64')), decipher.final()]);
};

/**
 * Decrypt a Data Encryption Key (DEK). With a key id, only that key is tried;
 * without one (a v1 envelope), each key of the ring in turn.
 *
 * @param {string|null} keyId - the id the envelope names, or null for v1
 */
const decryptDEK = (keyId, encryptedDEK64, iv64, authTag64) => {
  if (keyId !== null && !RING.keys.has(keyId)) {
    logger.error('KMS: envelope names a master key that is not configured', { keyId });
    throw new AppError(
      500,
      `Failed to unwrap DEK: master key ${keyId} is not configured (KMS_MASTER_KEY / KMS_MASTER_KEY_PREVIOUS)`,
    );
  }
  const candidates = keyId !== null ? [RING.keys.get(keyId)] : [...RING.keys.values()];
  for (const masterKey of candidates) {
    try {
      return unwrapDEK(masterKey, encryptedDEK64, iv64, authTag64);
    } catch {
      // Not this key (GCM authentication failed) — try the next one.
    }
  }
  logger.error('KMS Decryption failed for DEK', { keyId, triedKeys: candidates.length });
  throw new AppError(500, 'Failed to unwrap DEK');
};

/**
 * Encrypts data using Envelope Encryption:
 * 1. Generates a random DEK (Data Encryption Key)
 * 2. Encrypts the plaintext with the DEK
 * 3. Encrypts the DEK with the current Master Key
 * 4. Returns the combined payload, naming the master key (v2)
 */
exports.encryptData = (tenantId, plaintext) => {
  if (!plaintext) return null;

  try {
    // 1. Generate DEK
    const dek = crypto.randomBytes(32);

    // 2. Encrypt Data with DEK
    const dataIv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, dataIv);

    // Add tenantId as Additional Authenticated Data (AAD) to prevent tampering across tenants
    cipher.setAAD(Buffer.from(tenantId));

    const encryptedData = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const dataAuthTag = cipher.getAuthTag();

    // 3. Encrypt DEK with Master Key
    const { encryptedDEK, iv: dekIv, authTag: dekAuthTag } = encryptDEK(dek);

    // 4. Construct payload: v2 : keyId : encDEK : dekIv : dekAuthTag : encData : dataIv : dataAuthTag
    return [
      'v2',
      RING.currentId,
      encryptedDEK,
      dekIv,
      dekAuthTag,
      encryptedData.toString('base64'),
      dataIv.toString('base64'),
      dataAuthTag.toString('base64')
    ].join(':');

  } catch (err) {
    logger.error('Data encryption failed', { error: err.message, tenantId });
    throw new AppError(500, 'Failed to encrypt data');
  }
};

/**
 * Parse an envelope into its key id (null for v1) and the six crypto fields.
 * @throws {Error} on a wrong number of parts
 */
const parseEnvelope = (payload) => {
  const parts = payload.split(':');
  if (parts[0] === 'v2') {
    if (parts.length !== 8) throw new Error('Invalid payload structure');
    return { keyId: parts[1], fields: parts.slice(2) };
  }
  if (parts.length !== 7) throw new Error('Invalid payload structure');
  return { keyId: null, fields: parts.slice(1) };
};

/**
 * Decrypts data using Envelope Encryption:
 * 1. Parses the payload (v1 or v2)
 * 2. Decrypts the DEK with the Master Key it names (v2) or any of the ring (v1)
 * 3. Decrypts the data with the unwrapped DEK
 */
exports.decryptData = (tenantId, payload) => {
  if (!exports.isEnvelope(payload)) return payload; // Return as-is if not encrypted

  try {
    const { keyId, fields } = parseEnvelope(payload);
    const [encryptedDEK, dekIv, dekAuthTag, encryptedData, dataIv, dataAuthTag] = fields;

    // 2. Decrypt DEK
    const dek = decryptDEK(keyId, encryptedDEK, dekIv, dekAuthTag);

    // 3. Decrypt Data
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(dataIv, 'base64'));
    decipher.setAuthTag(Buffer.from(dataAuthTag, 'base64'));
    decipher.setAAD(Buffer.from(tenantId));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData, 'base64')),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  } catch (err) {
    logger.error('Data decryption failed', { error: err.message, tenantId });
    // In some cases (e.g. key rotation or corruption), we might not want to throw and crash the whole request,
    // but throwing is safest to prevent data loss or silent failures.
    throw new AppError(500, 'Failed to decrypt data');
  }
};

/**
 * @param {*} payload - a stored value
 * @returns {boolean} true when it is an envelope NOT written under the current
 *   master key (a v1 envelope, or a v2 naming another key) — what a re-wrap
 *   must visit
 */
exports.needsRewrap = (payload) =>
  exports.isEnvelope(payload) && !payload.startsWith(`v2:${RING.currentId}:`);

/**
 * Re-wrap an envelope under the current master key: decrypt (with whichever
 * key it names) and encrypt again. The tenant id is the same AAD both ways.
 *
 * @param {string} tenantId
 * @param {string} payload - an envelope
 * @returns {string} a v2 envelope under the current key
 */
exports.rewrap = (tenantId, payload) => exports.encryptData(tenantId, exports.decryptData(tenantId, payload));

/**
 * @returns {{currentKeyId: string, previousKeyIds: string[]}} the ring's ids — fingerprints, not keys
 */
exports.keyInfo = () => ({ currentKeyId: RING.currentId, previousKeyIds: [...RING.previousIds] });
