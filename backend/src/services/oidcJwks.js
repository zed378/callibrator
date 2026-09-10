/**
 * OIDC JWKS (JSON Web Key Set) Verification Service
 *
 * Provides secure verification of OIDC id_tokens by fetching and caching
 * the Identity Provider's public keys from their JWKS endpoint.
 *
 * SECURITY: This replaces the insecure jwt.decode() only verification
 * that was previously used in verifyOidcCallback().
 */

const axios = require("axios");
const jwt = require("jsonwebtoken");
const jwkToPem = require("jwk-to-pem");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");

// ==========================================
// JWKS CACHE
// ==========================================

/**
 * JWKS Cache - TTL-based caching for IdP public keys
 * Reduces JWKS fetches and improves performance
 */
class JwksCache {
  constructor(ttlMs = 6 * 60 * 60 * 1000) {
    // 6 hours default
    this._cache = new Map();
    this._ttl = ttlMs;
  }

  get(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key, value) {
    this._cache.set(key, {
      value,
      expiresAt: Date.now() + this._ttl,
    });
  }

  clear() {
    this._cache.clear();
  }

  size() {
    return this._cache.size;
  }
}

const jwksCache = new JwksCache();

// ==========================================
// JWKS FETCHER
// ==========================================

/**
 * Fetch JWKS from the Identity Provider
 * @param {string} issuer - OIDC issuer URL
 * @returns {Promise<{keys: Array}>} JWKS document
 */
async function fetchJwks(issuer) {
  // Normalize issuer URL
  const baseUrl = issuer.replace(/\/$/, "");
  const jwksUrl = `${baseUrl}/.well-known/jwks.json`;

  // Check cache first
  const cached = jwksCache.get(jwksUrl);
  if (cached) {
    logger.debug("JWKS cache hit", { issuer });
    return cached;
  }

  try {
    const response = await axios.get(jwksUrl, {
      timeout: 10000, // 10 second timeout
      headers: {
        "Accept": "application/json",
        "User-Agent": "Callibrator-OIDC/1.0",
      },
      // SECURITY: Validate TLS certificate
      httpsAgent: new (require("https").Agent)({
        rejectUnauthorized: true,
      }),
    });

    const jwks = response.data;

    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new AppError(500, "Invalid JWKS response from IdP");
    }

    // Cache the JWKS
    jwksCache.set(jwksUrl, jwks);
    logger.info("JWKS fetched and cached", {
      issuer,
      keyCount: jwks.keys.length,
    });

    return jwks;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.response) {
      logger.error("JWKS fetch failed", {
        issuer,
        status: err.response.status,
        data: err.response.data,
      });
      throw new AppError(500, "Failed to fetch IdP public keys");
    }
    logger.error("JWKS fetch error", { issuer, error: err.message });
    throw new AppError(500, "Failed to fetch IdP public keys");
  }
}

// ==========================================
// TOKEN VERIFICATION
// ==========================================

/**
 * Find the matching JWK for a JWT header kid
 * @param {Object} jwks - JWKS document
 * @param {string} kid - Key ID from JWT header
 * @returns {Object} Matching JWK
 */
function findJwkByKeyId(jwks, kid) {
  if (!kid) {
    throw new AppError(401, "JWT missing 'kid' header");
  }

  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) {
    throw new AppError(
      401,
      `No matching public key found for JWT with kid: ${kid}`,
    );
  }

  return jwk;
}

/**
 * Verify OIDC id_token signature using JWKS
 * @param {string} idToken - The JWT id_token from OIDC callback
 * @param {string} issuer - OIDC issuer URL
 * @param {string} clientId - Expected client ID
 * @returns {Object} Decoded and verified ID token payload
 */
exports.verifyIdToken = async (idToken, issuer, clientId) => {
  if (!idToken) {
    throw new AppError(400, "id_token is required");
  }

  if (!issuer) {
    throw new AppError(400, "OIDC issuer URL is required");
  }

  if (!clientId) {
    throw new AppError(400, "OIDC client ID is required");
  }

  try {
    // Decode header without verification to get kid and alg
    const header = jwt.decode(idToken, { complete: true })?.header;
    if (!header) {
      throw new AppError(401, "Invalid id_token format");
    }

    const { kid, alg } = header;

    // Validate algorithm - only allow RS256 or ES256
    const allowedAlgorithms = [
      "RS256",
      "ES256",
      "RS384",
      "ES384",
      "RS512",
      "ES512",
    ];
    if (!allowedAlgorithms.includes(alg)) {
      throw new AppError(
        401,
        `Unsupported or insecure JWT algorithm: ${alg}. Allowed: ${allowedAlgorithms.join(", ")}`,
      );
    }

    // Fetch JWKS
    const jwks = await fetchJwks(issuer);

    // Find matching key
    const jwk = findJwkByKeyId(jwks, kid);

    // Convert JWK to PEM
    const pem = jwkToPem(jwk);

    // Verify token
    const decoded = jwt.verify(idToken, pem, {
      algorithms: [alg],
      audience: clientId,
      issuer: issuer,
      maxAge: "15m", // id_tokens should be fresh (allow 5-min clock skew)
    });

    logger.info("OIDC id_token verified via JWKS", {
      issuer,
      kid,
      alg,
      clientId,
    });

    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === "TokenExpiredError") {
      throw new AppError(401, "id_token has expired");
    }
    if (err.name === "JsonWebTokenError") {
      throw new AppError(401, "Invalid id_token signature");
    }
    throw err;
  }
};

/**
 * Verify OIDC callback and extract user info
 * Replaces the previous insecure jwt.decode() only verification
 * @param {string} code - Authorization code
 * @param {Object} ssoSettings - SSO settings
 * @param {string} redirectUri - Redirect URI used in auth request
 * @returns {Promise<{email: string, firstName: string, lastName: string}>}
 */
exports.verifyOidcCallback = async (code, ssoSettings, redirectUri) => {
  const clientId = ssoSettings.oidc_client_id;
  const clientSecret = ssoSettings.oidc_client_secret;
  const authority =
    ssoSettings.oidc_authority ||
    "https://login.microsoftonline.com/common/oauth2/v2.0";
  const issuer = ssoSettings.oidc_authority || authority;

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(
      `${authority}/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      },
    );

    const idToken = tokenResponse.data.id_token;
    if (!idToken) {
      throw new AppError(400, "No id_token returned from token endpoint");
    }

    // SECURITY: Verify id_token signature using JWKS
    // This replaces the previous insecure jwt.decode() only verification
    const decoded = await exports.verifyIdToken(idToken, issuer, clientId);

    return {
      email: (
        decoded.email ||
        decoded.preferred_username ||
        decoded.upn ||
        ""
      ).toLowerCase(),
      firstName: decoded.given_name || decoded.name?.split(" ")[0] || "SSO",
      lastName: decoded.family_name || "User",
      // Include additional claims for audit
      nonce: decoded.nonce,
      authTime: decoded.auth_time,
      acr: decoded.acr,
      amr: decoded.amr,
      sub: decoded.sub,
    };
  } catch (err) {
    if (err instanceof AppError) {
      logger.error("OIDC verification failed", {
        error: err.message,
        issuer,
      });
      throw err;
    }
    logger.error("OIDC verification error", {
      error: err.message,
      response: err.response?.data,
      issuer,
    });
    throw new AppError(401, "OIDC authentication failed");
  }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get current JWKS info (for monitoring/debugging)
 * @param {string} issuer - OIDC issuer URL
 * @returns {Promise<Object>} JWKS metadata
 */
exports.getJwksInfo = async (issuer) => {
  const jwks = await fetchJwks(issuer);
  return {
    issuer,
    keyCount: jwks.keys.length,
    keys: jwks.keys.map((k) => ({
      kid: k.kid,
      alg: k.alg,
      use: k.use,
      keyOps: k.key_ops,
    })),
  };
};

/**
 * Clear JWKS cache (for testing/maintenance)
 */
exports.clearCache = () => {
  jwksCache.clear();
  logger.info("JWKS cache cleared");
};

/**
 * Get cache stats
 */
exports.getCacheStats = () => {
  return {
    size: jwksCache.size(),
    ttl: jwksCache._ttl,
  };
};
