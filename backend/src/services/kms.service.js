const crypto = require('crypto');
const { AppError } = require('../utils/appError.util');
const { logger } = require('../middlewares/activityLog.middleware');

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
const MASTER_KEY_HEX = process.env.KMS_MASTER_KEY || crypto.createHash('sha256').update('local-kms-mock-key').digest('hex');
const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, 'hex');
if (MASTER_KEY.length !== 32) {
  throw new Error(
    `KMS_MASTER_KEY must decode to 32 bytes (got ${MASTER_KEY.length}); provide a 64-character hex string.`,
  );
}

/**
 * Encrypt a Data Encryption Key (DEK) with the KMS Master Key
 */
const encryptDEK = (dekBuffer) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  
  const encryptedDEK = Buffer.concat([cipher.update(dekBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedDEK: encryptedDEK.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
};

/**
 * Decrypt a Data Encryption Key (DEK) with the KMS Master Key
 */
const decryptDEK = (encryptedDEK64, iv64, authTag64) => {
  try {
    const encryptedDEK = Buffer.from(encryptedDEK64, 'base64');
    const iv = Buffer.from(iv64, 'base64');
    const authTag = Buffer.from(authTag64, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([decipher.update(encryptedDEK), decipher.final()]);
  } catch (err) {
    logger.error('KMS Decryption failed for DEK', { error: err.message });
    throw new AppError(500, 'Failed to unwrap DEK');
  }
};

/**
 * Encrypts data using Envelope Encryption:
 * 1. Generates a random DEK (Data Encryption Key)
 * 2. Encrypts the plaintext with the DEK
 * 3. Encrypts the DEK with the Master Key
 * 4. Returns the combined payload
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

    // 4. Construct payload: version : encDEK : dekIv : dekAuthTag : encData : dataIv : dataAuthTag
    return [
      'v1',
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
 * Decrypts data using Envelope Encryption:
 * 1. Parses the payload
 * 2. Decrypts the DEK with the Master Key
 * 3. Decrypts the data with the unwrapped DEK
 */
exports.decryptData = (tenantId, payload) => {
  if (!payload || !payload.startsWith('v1:')) return payload; // Return as-is if not encrypted

  try {
    const parts = payload.split(':');
    if (parts.length !== 7) throw new Error('Invalid payload structure');

    const [version, encryptedDEK, dekIv, dekAuthTag, encryptedData, dataIv, dataAuthTag] = parts;

    // 2. Decrypt DEK
    const dek = decryptDEK(encryptedDEK, dekIv, dekAuthTag);

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
