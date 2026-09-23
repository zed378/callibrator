/**
 * Real RSA key material for the e-signature tests.
 *
 * These tests verify a cryptographic contract, so they use a REAL key pair and
 * the REAL node crypto primitives — a mocked signer would prove only that the
 * service calls a function, which is precisely the class of test that let the
 * original defect (a signature over Date.now()) pass for months.
 *
 * Generating a 2048-bit pair costs ~100-300ms, so callers should build one per
 * file in a `beforeAll` and reuse it.
 */

const crypto = require("crypto");

/**
 * Mirror of eSignature.service#encryptPrivateKey — AES-256-CBC under the
 * SHA-256 of process.env.ENCRYPT_KEY, stored as `iv:ciphertext` hex.
 * @param {string} privateKeyPem
 * @param {string} secret - the ENCRYPT_KEY the service under test will read
 * @returns {string}
 */
const encryptPrivateKeyForTest = (privateKeyPem, secret) => {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(privateKeyPem, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
};

/**
 * Generate a key pair shaped like a stored TenantKey row.
 * @param {Object} [options]
 * @param {string} [options.keyId]
 * @param {string} [options.secret] - ENCRYPT_KEY value (default: the env value)
 * @returns {{keyId: string, publicKey: string, privateKey: string, privateKeyPem: string}}
 */
const generateTestKeyPair = ({ keyId = "key-test-1", secret } = {}) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return {
    keyId,
    publicKey,
    privateKeyPem: privateKey,
    privateKey: encryptPrivateKeyForTest(
      privateKey,
      secret === undefined ? process.env.ENCRYPT_KEY : secret,
    ),
  };
};

module.exports = { generateTestKeyPair, encryptPrivateKeyForTest };
