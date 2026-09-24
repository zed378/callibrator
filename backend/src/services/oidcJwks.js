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
const crypto = require("crypto");
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
async function fetchJwks(issuer, jwksUri) {
  // A-188: the IdP's published `jwks_uri` when discovery found one (Entra ID
  // keeps its keys at …/discovery/v2.0/keys); otherwise the path this client
  // always derived from the issuer.
  const jwksUrl = jwksUri || `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;

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
 * @param {{jwksUri?: string}} [options] - A-188: the discovered `jwks_uri`
 * @returns {Object} Decoded and verified ID token payload
 */
exports.verifyIdToken = async (idToken, issuer, clientId, { jwksUri } = {}) => {
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
    const jwks = await fetchJwks(issuer, jwksUri);

    // Find matching key
    const jwk = findJwkByKeyId(jwks, kid);

    // Convert JWK to PEM with Node's own crypto. This replaced the jwk-to-pem
    // package, whose elliptic dependency carries an unfixed advisory
    // (GHSA-848j-6mx2-7j84). A malformed key throws here and propagates as a
    // server error, exactly as jwk-to-pem's throw did: it is an IdP
    // configuration fault, not a bad token.
    const pem = crypto
      .createPublicKey({ key: jwk, format: "jwk" })
      .export({ type: "spki", format: "pem" });

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
 * @param {{nonce: string, codeVerifier: string}} flow - A-68: the `nonce` and
 *   PKCE `code_verifier` stored when this sign-in began. Both are required: the
 *   verifier goes to the token endpoint (the IdP checks it against the
 *   `code_challenge` it was sent), and the ID token's `nonce` claim must equal
 *   the stored one. Without them the callback is refused, never waved through.
 * @returns {Promise<{email: string, firstName: string, lastName: string}>}
 */
exports.verifyOidcCallback = async (code, ssoSettings, redirectUri, flow = {}) => {
  const { nonce, codeVerifier } = flow;
  if (!nonce || !codeVerifier) {
    throw new AppError(401, "OIDC sign-in state is incomplete");
  }
  const clientId = ssoSettings.oidc_client_id;
  const clientSecret = ssoSettings.oidc_client_secret;
  // A-188: the endpoints and the issuer come from the IdP's discovery
  // document (a configuration fault is an AppError and propagates as one).
  const provider = await exports.discover(ssoSettings);
  const { issuer } = provider;

  // A-188: a PUBLIC client (no secret configured — PKCE is its proof) sends no
  // client_secret at all. URLSearchParams turned the missing value into the
  // literal string "undefined", which an IdP reads as a wrong secret.
  const tokenRequest = {
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };
  if (typeof clientSecret === "string" && clientSecret !== "") {
    tokenRequest.client_secret = clientSecret;
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(
      provider.tokenEndpoint,
      new URLSearchParams(tokenRequest).toString(),
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
    const decoded = await exports.verifyIdToken(idToken, issuer, clientId, {
      jwksUri: provider.jwksUri,
    });

    // A-68: the nonce binds this ID token to the sign-in THIS server started.
    // A token minted for another request (replayed, or injected with a stolen
    // code) carries another nonce, or none.
    if (decoded.nonce !== nonce) {
      throw new AppError(401, "id_token nonce does not match the sign-in request");
    }

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
// A-188 — PROVIDER DISCOVERY
// ==========================================
//
// This client used to DERIVE every endpoint from the configured authority:
// `${authority}/authorize`, `${authority}/token`,
// `${authority}/.well-known/jwks.json`, and it expected the ID token's `iss`
// to equal the authority string. Microsoft Entra ID fits none of that — its
// keys are at …/discovery/v2.0/keys, and the issuer of a tenant-specific
// token is https://login.microsoftonline.com/<tenant-id>/v2.0 — so an Entra
// sign-in could never be verified.
//
// Now the endpoints and the issuer come from the IdP's OpenID Provider
// Metadata (OpenID Connect Discovery 1.0), at
// `<authority>/.well-known/openid-configuration`, cached for an hour.
//
//  - An authority written the way this client used to document it for Entra,
//    https://login.microsoftonline.com/<tenant>/oauth2/v2.0, is read as the
//    issuer base https://login.microsoftonline.com/<tenant>/v2.0 — the
//    document lives there, not under /oauth2.
//  - A MULTI-TENANT authority (Entra's /common or /organizations) publishes
//    an issuer with a `{tenantid}` placeholder. It is refused: it would admit
//    any directory's users into this hospital's tenant through JIT
//    provisioning. Configure the hospital's own directory.
//  - An IdP that answers the discovery URL with 404 publishes no metadata;
//    the endpoints this client always derived are used for it, as before.
//    Any other failure is a failure — never a silent fallback.

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new JwksCache(DISCOVERY_TTL_MS);

/** An absolute http(s) URL, or null. */
const endpointUrl = (value) => {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The tenant's OIDC authority, without a trailing slash.
 *
 * @param {object} ssoSettings
 * @returns {string}
 * @throws {AppError} 400 when none is configured — there is no default: the
 *   old default was Entra's multi-tenant /common, refused below
 */
const authorityOf = (ssoSettings) => {
  const authority = String(ssoSettings.oidc_authority || "").trim().replace(/\/+$/, "");
  if (!authority) {
    throw new AppError(400, "OIDC authority is not configured for this tenant");
  }
  return authority;
};

/**
 * Resolve the identity provider's endpoints and issuer.
 *
 * @param {object} ssoSettings - the tenant's settings (`oidc_authority`)
 * @returns {Promise<{issuer: string, authorizationEndpoint: string, tokenEndpoint: string, jwksUri: string, discovered: boolean}>}
 * @throws {AppError} 400 for an unusable configuration, 502 when the IdP
 *   cannot be read
 */
exports.discover = async (ssoSettings) => {
  const authority = authorityOf(ssoSettings);
  const base = authority.replace(/\/oauth2\/v2\.0$/i, "/v2.0");
  const metadataUrl = `${base}/.well-known/openid-configuration`;

  const cached = discoveryCache.get(metadataUrl);
  if (cached) {
    return cached;
  }

  let metadata;
  try {
    const response = await axios.get(metadataUrl, {
      timeout: 10000,
      headers: { Accept: "application/json", "User-Agent": "Callibrator-OIDC/1.0" },
    });
    metadata = response.data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      logger.warn("OIDC provider publishes no discovery document; deriving its endpoints", {
        authority,
      });
      const derived = {
        issuer: authority,
        authorizationEndpoint: `${authority}/authorize`,
        tokenEndpoint: `${authority}/token`,
        jwksUri: `${authority}/.well-known/jwks.json`,
        discovered: false,
      };
      discoveryCache.set(metadataUrl, derived);
      return derived;
    }
    logger.error("OIDC discovery failed", { authority, error: err.message });
    throw new AppError(502, "The identity provider could not be reached");
  }

  const provider = {
    issuer: typeof metadata?.issuer === "string" ? metadata.issuer : null,
    authorizationEndpoint: endpointUrl(metadata?.authorization_endpoint),
    tokenEndpoint: endpointUrl(metadata?.token_endpoint),
    jwksUri: endpointUrl(metadata?.jwks_uri),
    discovered: true,
  };
  if (!provider.issuer || !provider.authorizationEndpoint || !provider.tokenEndpoint || !provider.jwksUri) {
    logger.error("OIDC discovery document is incomplete", { authority });
    throw new AppError(502, "The identity provider's discovery document is incomplete");
  }
  if (/\{tenantid\}/i.test(provider.issuer)) {
    throw new AppError(
      400,
      "The OIDC authority is multi-tenant (for example /common); configure the organisation's own directory",
    );
  }

  discoveryCache.set(metadataUrl, provider);
  return provider;
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
  discoveryCache.clear();
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
