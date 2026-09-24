const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// ==========================================
// ENV VALIDATION
// ==========================================

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// Validate JWT secrets are configured at startup
if (!ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET environment variable is required");
}

if (!REFRESH_SECRET) {
  throw new Error("JWT_REFRESH_SECRET environment variable is required");
}

// A-31. Two secrets that are equal are one secret: whether a refresh token is
// accepted as an access token then depends only on claim checks, not on
// cryptography. The configuration document said "the config should reject that
// rather than trusting whoever wrote the .env" — it did not. Now it does.
if (ACCESS_SECRET === REFRESH_SECRET) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ: equal secrets make the two token types interchangeable",
  );
}

// ==========================================
// ENV
// ==========================================

// The verification algorithm list is pinned in code. Reading it from the
// environment unchecked lets whoever writes the .env choose how tokens are
// verified, which is not a deployment decision (A-31).
const SUPPORTED_ALGORITHMS = [
  "HS256",
  "HS384",
  "HS512",
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
];

const JWT_ALGORITHM = process.env.JWT_ALGORITHM || "HS256";

if (!SUPPORTED_ALGORITHMS.includes(JWT_ALGORITHM)) {
  throw new Error(
    `JWT_ALGORITHM "${JWT_ALGORITHM}" is not supported. Use one of: ${SUPPORTED_ALGORITHMS.join(", ")}`,
  );
}

// Token type claim. Without it the two token types are distinguished only by
// which secret signed them — and until 2026-09-23 the legacy JWT refresh token
// was signed with the ACCESS secret (the key registry holds only that one), so
// `verifyAccessToken` would have accepted it.
//
// A token with NO `typ` is still accepted: nothing in this codebase issues one
// any more (every refresh token in use is opaque, see generateOpaqueRefreshToken),
// and refusing them would invalidate every access token in flight at deploy
// time. A token whose `typ` names the OTHER type is refused outright.
const TOKEN_TYPE_ACCESS = "access";
const TOKEN_TYPE_REFRESH = "refresh";

const assertTokenType = (decoded, expected) => {
  if (decoded && typeof decoded === "object" && decoded.typ && decoded.typ !== expected) {
    throw new Error(`Expected a ${expected} token`);
  }
  return decoded;
};

// A-59. Single-purpose tokens. Each is signed with the access key (so key
// rotation applies) but carries its own `typ`, which does two things:
//   - verifyAccessToken refuses it (assertTokenType above: a `typ` that is not
//     "access" is refused), so none of these works as a bearer credential;
//   - verifyPurposeToken accepts it ONLY for its own type, and — unlike the
//     access check — requires the claim to be PRESENT. A token with no `typ`
//     is never a purpose token.
// Until A-59 the activation token (sent by email) and the MFA-pending token
// were minted by generateAccessToken, so both were full access tokens; the
// socket handshake token carried no `typ` at all, so it was one too.
//
// `ttl` is the lifetime when the caller does not pass one. The activation
// token used to inherit JWT_ACCESS_EXPIRED (15m documented, 1d deployed); an
// activation link is now valid for a day whatever the access lifetime is.
const PURPOSE_TOKEN_TYPES = Object.freeze({
  activation: { ttl: "24h" },
  mfa: { ttl: "5m" },
  socket: { ttl: 300 },
});

const assertPurposeType = (typ) => {
  if (!Object.prototype.hasOwnProperty.call(PURPOSE_TOKEN_TYPES, typ)) {
    throw new Error(`Unknown token purpose "${typ}"`);
  }
};

const assertExactTokenType = (decoded, expected) => {
  if (!decoded || typeof decoded !== "object" || decoded.typ !== expected) {
    throw new Error(`Expected a ${expected} token`);
  }
  return decoded;
};

const JWT_KEY_VERSION = process.env.JWT_KEY_VERSION || "1";
const JWT_ROTATION_INTERVAL_HOURS =
  parseInt(process.env.JWT_ROTATION_INTERVAL) || 720; // 30 days default

// ==========================================
// KEY MANAGEMENT (Supports key rotation)
// ==========================================

/**
 * JWT Key Registry
 * Supports multiple active keys for rotation without invalidating existing tokens
 * In production, store keys in a secure vault (AWS Secrets Manager, Azure Key Vault, etc.)
 */
class JwtKeyRegistry {
  constructor() {
    // Active keys: { [keyId]: { secret, algorithm, activatedAt, expiresAt } }
    this._keys = new Map();
    this._currentKeyId = process.env.JWT_KEY_ID || "default";
    this._initializeDefaultKey();
  }

  _initializeDefaultKey() {
    const now = Date.now();
    this._keys.set(this._currentKeyId, {
      secret: ACCESS_SECRET,
      algorithm: JWT_ALGORITHM,
      activatedAt: new Date(now - JWT_ROTATION_INTERVAL_HOURS * 60 * 60 * 1000),
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000), // 30 days
    });
  }

  /**
   * Get the current active key for signing
   */
  getCurrentKey() {
    const keys = Array.from(this._keys.values());
    const activeKeys = keys.filter((k) => {
      const now = Date.now();
      return now >= k.activatedAt.getTime() && now <= k.expiresAt.getTime();
    });
    return activeKeys[activeKeys.length - 1] || keys[keys.length - 1];
  }

  /**
   * Get all active keys for verification (supports multiple active keys during rotation)
   */
  getActiveKeys() {
    const now = Date.now();
    return Array.from(this._keys.entries())
      .filter(([keyId, key]) => {
        return (
          now >= key.activatedAt.getTime() && now <= key.expiresAt.getTime()
        );
      })
      .map(([keyId, key]) => ({ keyId, ...key }));
  }

  /**
   * Rotate keys - create a new key and optionally retire old ones
   * @param {string} newSecret - The new secret key
   * @param {string} newAlgorithm - Algorithm (HS256, RS256, ES256, etc.)
   * @returns {string} The new key ID
   */
  rotateKey(newSecret, newAlgorithm = JWT_ALGORITHM) {
    const newKeyId = crypto.randomUUID();
    const now = Date.now();

    this._keys.set(newKeyId, {
      secret: newSecret,
      algorithm: newAlgorithm,
      activatedAt: new Date(now),
      expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000), // 1 year
    });

    this._currentKeyId = newKeyId;
    return newKeyId;
  }

  /**
   * Retire a key (prevent new token signing with it)
   */
  retireKey(keyId) {
    const key = this._keys.get(keyId);
    if (key) {
      key.expiresAt = new Date(Date.now());
    }
  }

  /**
   * Get key by ID (for debugging/monitoring)
   */
  getKey(keyId) {
    return this._keys.get(keyId) || null;
  }

  /**
   * Get all key IDs (for monitoring)
   */
  getKeyIds() {
    return Array.from(this._keys.keys());
  }
}

// Singleton instance
const keyRegistry = new JwtKeyRegistry();

// ==========================================
// ACCESS TOKEN
// ==========================================

/**
 * Sign with the current access key. Shared by access and purpose tokens.
 * @param {object} signPayload - claims, `typ` already set
 * @param {string|number} expiresIn
 * @param {string} [algorithmOverride]
 * @returns {string}
 */
const signWithAccessKey = (signPayload, expiresIn, algorithmOverride) => {
  const key = keyRegistry.getCurrentKey();
  const algorithm = algorithmOverride || key.algorithm;

  // For HS* algorithms, use the secret directly
  // For RS*/ES* algorithms, a private key file path would be used
  if (algorithm.startsWith("RS") || algorithm.startsWith("ES")) {
    const privateKey = process.env.JWT_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        `Algorithm ${algorithm} requires JWT_PRIVATE_KEY environment variable`,
      );
    }
    return jwt.sign(signPayload, privateKey, {
      expiresIn,
      algorithm,
      keyid: keyRegistry._currentKeyId,
    });
  }

  return jwt.sign(signPayload, key.secret, {
    expiresIn,
    algorithm,
    keyid: keyRegistry._currentKeyId,
  });
};

const generateAccessToken = (payload, options = {}) => {
  const basePayload =
    typeof payload === "object" && payload !== null ? payload : { id: payload };
  return signWithAccessKey(
    { ...basePayload, typ: TOKEN_TYPE_ACCESS },
    options.expiresIn || process.env.JWT_ACCESS_EXPIRED || "15m",
    options.algorithm,
  );
};

/**
 * A-59. Mint a single-purpose token (activation, mfa, socket). It is refused
 * by verifyAccessToken and accepted only by verifyPurposeToken for the same
 * type.
 *
 * @param {object} payload - claims (identifiers only)
 * @param {"activation"|"mfa"|"socket"} typ
 * @param {{expiresIn?: string|number, algorithm?: string}} [options]
 * @returns {string}
 */
const generatePurposeToken = (payload, typ, options = {}) => {
  assertPurposeType(typ);
  return signWithAccessKey(
    { ...payload, typ },
    options.expiresIn || PURPOSE_TOKEN_TYPES[typ].ttl,
    options.algorithm,
  );
};

// ==========================================
// OPAQUE REFRESH TOKEN
// ==========================================

const generateOpaqueRefreshToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// ==========================================
// REFRESH TOKEN (legacy)
// ==========================================

const generateRefreshToken = (payload) => {
  const basePayload =
    typeof payload === "object" && payload !== null ? payload : { id: payload };

  // The legacy JWT refresh token is symmetric and signed with REFRESH_SECRET,
  // whatever JWT_ALGORITHM says. Asymmetric algorithms and key rotation apply
  // to ACCESS tokens: the key registry holds ACCESS_SECRET, and signing refresh
  // tokens from it is what made the two interchangeable (A-31).
  //
  // Note that nothing in the login flow calls this — every refresh token this
  // application issues is opaque (generateOpaqueRefreshToken) and stored.
  return jwt.sign({ ...basePayload, typ: TOKEN_TYPE_REFRESH }, REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRED || "7d",
    algorithm: "HS256",
  });
};

// ==========================================
// VERIFY ACCESS TOKEN
// ==========================================

/**
 * Verify against the access-key registry, then apply `checkType` to the
 * payload. Shared by access and purpose tokens.
 * @param {string} token
 * @param {(decoded: object) => object} checkType - throws on the wrong type
 * @param {string} failureMessage
 * @returns {object}
 */
const verifyWithAccessKeys = (token, checkType, failureMessage) => {
  const activeKeys = keyRegistry.getActiveKeys();

  // Try each active key until one succeeds
  for (const keyInfo of activeKeys) {
    try {
      const algorithm = keyInfo.algorithm;

      if (algorithm.startsWith("RS") || algorithm.startsWith("ES")) {
        const publicKey = process.env.JWT_PUBLIC_KEY;
        if (!publicKey) {
          continue;
        }
        // Do NOT cap with maxAge here: access tokens are signed with
        // expiresIn = JWT_ACCESS_EXPIRED (1d by default). jwt.verify already
        // enforces the token's own `exp`; a hardcoded maxAge:"15m" silently
        // rejected every token 15 min after issuance regardless of exp.
        return checkType(
          jwt.verify(token, publicKey, {
            algorithms: [algorithm],
          }),
        );
      }

      return checkType(
        jwt.verify(token, keyInfo.secret, {
          algorithms: [algorithm],
        }),
      );
    } catch (err) {
      // Try next key
      if (err.name === "TokenExpiredError") {
        throw err; // Don't suppress expiration errors
      }
      // Store error but continue trying keys
    }
  }

  // If no active keys matched, try the default secret as fallback (backward compat)
  try {
    return checkType(
      jwt.verify(token, ACCESS_SECRET, {
        algorithms: ["HS256"],
      }),
    );
  } catch {
    throw new Error(failureMessage);
  }
};

const verifyAccessToken = (token) =>
  verifyWithAccessKeys(
    token,
    (decoded) => assertTokenType(decoded, TOKEN_TYPE_ACCESS),
    "Invalid or expired access token",
  );

/**
 * A-59. Verify a single-purpose token. Accepts ONLY a token whose `typ` is
 * exactly `typ` — an access token, a refresh token, a token of another purpose
 * and a token with no `typ` are all refused.
 *
 * @param {string} token
 * @param {"activation"|"mfa"|"socket"} typ
 * @returns {object} the verified payload
 */
const verifyPurposeToken = (token, typ) => {
  assertPurposeType(typ);
  return verifyWithAccessKeys(
    token,
    (decoded) => assertExactTokenType(decoded, typ),
    `Invalid or expired ${typ} token`,
  );
};

// ==========================================
// VERIFY REFRESH TOKEN
// ==========================================

const verifyRefreshToken = (token) => {
  // Refresh tokens are verified against REFRESH_SECRET alone. They are not part
  // of the access-key rotation registry — that registry holds ACCESS_SECRET, and
  // verifying a refresh token against it is what made the two interchangeable
  // (A-31). Note that every refresh token this application actually issues is
  // OPAQUE (generateOpaqueRefreshToken); this path exists for the legacy JWT
  // flavour and for callers outside the login flow.
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET, {
      algorithms: ["HS256"],
    });
    return assertTokenType(decoded, TOKEN_TYPE_REFRESH);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw err;
    }
    throw new Error("Invalid or expired refresh token");
  }
};

// ==========================================
// KEY ROTATION API
// ==========================================

/**
 * Rotate JWT signing keys
 * @param {string} algorithm - Algorithm: HS256, RS256, ES256, etc.
 * @returns {Object} { keyId, algorithm, activatedAt, expiresAt }
 */
const rotateKeys = (algorithm = JWT_ALGORITHM) => {
  let newSecret;

  if (algorithm.startsWith("HS")) {
    // Symmetric key
    newSecret = crypto.randomBytes(64).toString("hex");
  } else if (algorithm.startsWith("RS")) {
    // RSA key pair
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.JWT_PUBLIC_KEY = publicKey;
    process.env.JWT_PRIVATE_KEY = privateKey;
    newSecret = publicKey; // For RS*, verification uses public key
  } else if (algorithm.startsWith("ES")) {
    // ECDSA key pair
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.JWT_PUBLIC_KEY = publicKey;
    process.env.JWT_PRIVATE_KEY = privateKey;
    newSecret = publicKey;
  } else {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }

  const newKeyId = keyRegistry.rotateKey(newSecret, algorithm);
  const key = keyRegistry.getKey(newKeyId);

  return {
    keyId: newKeyId,
    algorithm,
    activatedAt: key.activatedAt,
    expiresAt: key.expiresAt,
  };
};

/**
 * Get current key info (for monitoring/debugging)
 */
const getKeyInfo = () => {
  const currentKey = keyRegistry.getCurrentKey();
  return {
    keyId: keyRegistry._currentKeyId,
    algorithm: currentKey.algorithm,
    activatedAt: currentKey.activatedAt,
    expiresAt: currentKey.expiresAt,
    keyCount: keyRegistry.getKeyIds().length,
  };
};

/**
 * Get all active key IDs (for monitoring)
 */
const getActiveKeyIds = () => {
  return keyRegistry.getActiveKeys().map((k) => k.keyId);
};

// ==========================================
// DECODE
// ==========================================

const decodeToken = (token) => {
  return jwt.decode(token);
};

const generateToken = (payload, options = {}) => {
  return generateAccessToken(payload, options);
};

const verifyToken = (token) => {
  return verifyAccessToken(token);
};

module.exports = {
  generateToken,
  verifyToken,
  generateAccessToken,
  generatePurposeToken,
  generateOpaqueRefreshToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyPurposeToken,
  verifyRefreshToken,
  decodeToken,
  rotateKeys,
  getKeyInfo,
  getActiveKeyIds,
  keyRegistry,
};
