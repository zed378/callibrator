/**
 * OIDC JWKS (JSON Web Key Set) Verification Service
 *
 * Provides secure verification of OIDC id_tokens by fetching and caching
 * the Identity Provider's public keys from their JWKS endpoint.
 *
 * SECURITY: This replaces the insecure jwt.decode() only verification
 * that was previously used in verifyOidcCallback().
 *
 * P9-12 (ADR-087 Amendment 14): converted from oidcJwks.js with no behaviour
 * change. `export =` keeps the exact object `require()` returned, and the
 * functions that called their siblings through `exports.` call them through
 * that object (`service.`), so a spy on the module still intercepts them.
 */

import axios from "axios";
import { decode, verify, type Algorithm } from "jsonwebtoken";
import { createPublicKey, type JsonWebKeyInput } from "crypto";
import { logger } from "../middlewares/activityLog.middleware";
import { AppError } from "../utils/appError.util";
// A-176: every URL this module calls is tenant-chosen (the authority) or
// published by the tenant-chosen IdP (jwks_uri, token_endpoint).
import { assertOutboundUrl, ssrfSafeAxiosOptions } from "../utils/ssrf.util";
import type { TokenPayload } from "../types/auth";

/** What these functions read of a caught value (the JavaScript read these properties directly). */
interface ErrorLike {
  name?: string;
  message?: string;
  response?: { status?: number; data?: unknown };
}

/** One key of a JWKS document (RFC 7517), as read here. */
interface Jwk extends Omit<JsonWebKeyInput["key"], "kid" | "alg" | "use" | "key_ops"> {
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
}

/** A JWKS document. */
interface JwksDocument {
  keys: Jwk[];
}

/** The identity provider's endpoints and issuer (A-188). */
interface OidcProvider {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  discovered: boolean;
}

/** The tenant's OIDC settings these functions read. */
interface OidcSettings {
  oidc_authority?: unknown;
  oidc_client_id?: unknown;
  oidc_client_secret?: unknown;
}

// ==========================================
// JWKS CACHE
// ==========================================

/**
 * JWKS Cache - TTL-based caching for IdP public keys
 * Reduces JWKS fetches and improves performance
 */
class JwksCache<V> {
  _cache: Map<string, { value: V; expiresAt: number }>;
  _ttl: number;

  constructor(ttlMs = 6 * 60 * 60 * 1000) {
    // 6 hours default
    this._cache = new Map();
    this._ttl = ttlMs;
  }

  get(key: string): V | null {
    const entry = this._cache.get(key);
    if (!entry) {return null;}

    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key: string, value: V): void {
    this._cache.set(key, {
      value,
      expiresAt: Date.now() + this._ttl,
    });
  }

  clear(): void {
    this._cache.clear();
  }

  size(): number {
    return this._cache.size;
  }
}

const jwksCache = new JwksCache<JwksDocument>();

// ==========================================
// JWKS FETCHER
// ==========================================

/**
 * Fetch JWKS from the Identity Provider
 * @param issuer - OIDC issuer URL
 * @param jwksUri - the discovered `jwks_uri`, when there is one
 * @returns JWKS document
 */
async function fetchJwks(issuer: string, jwksUri?: string | null): Promise<JwksDocument> {
  // A-188: the IdP's published `jwks_uri` when discovery found one (Entra ID
  // keeps its keys at …/discovery/v2.0/keys); otherwise the path this client
  // always derived from the issuer.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" falls back too
  const jwksUrl = jwksUri || `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;

  // Check cache first
  const cached = jwksCache.get(jwksUrl);
  if (cached) {
    logger.debug("JWKS cache hit", { issuer });
    return cached;
  }

  try {
    // A-176: SSRF guard — validated URL, pinned DNS (TLS still verified),
    // no redirects, capped body.
    assertOutboundUrl(jwksUrl, "OIDC JWKS URL");
    const response = await axios.get(jwksUrl, {
      ...ssrfSafeAxiosOptions({ timeoutMs: 10000 }),
      headers: {
        "Accept": "application/json",
        "User-Agent": "Callibrator-OIDC/1.0",
      },
    });

    // The IdP's answer; its shape is checked just below.
    const jwks = response.data as JwksDocument | null | undefined;

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
  } catch (caught) {
    if (caught instanceof AppError) {throw caught;}
    const err = caught as ErrorLike;
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
 * @param jwks - JWKS document
 * @param kid - Key ID from JWT header
 * @returns Matching JWK
 */
function findJwkByKeyId(jwks: JwksDocument, kid: string | undefined): Jwk {
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
 * @param idToken - The JWT id_token from OIDC callback
 * @param issuer - OIDC issuer URL
 * @param clientId - Expected client ID
 * @param options - A-188: the discovered `jwks_uri`
 * @returns Decoded and verified ID token payload
 */
const verifyIdToken = async (
  idToken: string | null | undefined,
  issuer: string | null | undefined,
  clientId: string | null | undefined,
  { jwksUri }: { jwksUri?: string | null } = {},
): Promise<TokenPayload> => {
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
    const header = decode(idToken, { complete: true })?.header;
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
    const pem = createPublicKey({ key: jwk, format: "jwk" })
      .export({ type: "spki", format: "pem" });

    // Verify token
    // `alg` passed the allow-list above; an id_token is signed from an object.
    const decoded = verify(idToken, pem, {
      algorithms: [alg as Algorithm],
      audience: clientId,
      issuer: issuer,
      maxAge: "15m", // id_tokens should be fresh (allow 5-min clock skew)
    }) as TokenPayload;

    logger.info("OIDC id_token verified via JWKS", {
      issuer,
      kid,
      alg,
      clientId,
    });

    return decoded;
  } catch (caught) {
    if (caught instanceof AppError) {throw caught;}
    const err = caught as ErrorLike;
    if (err.name === "TokenExpiredError") {
      throw new AppError(401, "id_token has expired");
    }
    if (err.name === "JsonWebTokenError") {
      throw new AppError(401, "Invalid id_token signature");
    }
    throw caught;
  }
};

/** The identity an OIDC callback yields, with the claims kept for audit. */
interface OidcIdentity {
  email: string;
  firstName: string;
  lastName: string;
  nonce: unknown;
  authTime: unknown;
  acr: unknown;
  amr: unknown;
  sub: unknown;
}

/**
 * Verify OIDC callback and extract user info
 * Replaces the previous insecure jwt.decode() only verification
 * @param code - Authorization code
 * @param ssoSettings - SSO settings
 * @param redirectUri - Redirect URI used in auth request
 * @param flow - A-68: the `nonce` and PKCE `code_verifier` stored when this
 *   sign-in began. Both are required: the verifier goes to the token endpoint
 *   (the IdP checks it against the `code_challenge` it was sent), and the ID
 *   token's `nonce` claim must equal the stored one. Without them the callback
 *   is refused, never waved through.
 * @returns the user's email and names, with the claims kept for audit
 */
const verifyOidcCallback = async (
  code: string,
  ssoSettings: OidcSettings,
  redirectUri: string,
  flow: { nonce?: string; codeVerifier?: string } = {},
): Promise<OidcIdentity> => {
  const { nonce, codeVerifier } = flow;
  if (!nonce || !codeVerifier) {
    throw new AppError(401, "OIDC sign-in state is incomplete");
  }
  // The tenant's configured client id (a string, or absent).
  const clientId = ssoSettings.oidc_client_id as string;
  const clientSecret = ssoSettings.oidc_client_secret;
  // A-188: the endpoints and the issuer come from the IdP's discovery
  // document (a configuration fault is an AppError and propagates as one).
  const provider = await service.discover(ssoSettings);
  const { issuer } = provider;

  // A-188: a PUBLIC client (no secret configured — PKCE is its proof) sends no
  // client_secret at all. URLSearchParams turned the missing value into the
  // literal string "undefined", which an IdP reads as a wrong secret.
  const tokenRequest: Record<string, string> = {
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };
  if (typeof clientSecret === "string" && clientSecret !== "") {
    tokenRequest["client_secret"] = clientSecret;
  }

  try {
    // A-176: the token endpoint came from the IdP's discovery document.
    assertOutboundUrl(provider.tokenEndpoint, "OIDC token endpoint");
    // Exchange code for tokens
    const tokenResponse = await axios.post<{ id_token?: string }>(
      provider.tokenEndpoint,
      new URLSearchParams(tokenRequest).toString(),
      {
        ...ssrfSafeAxiosOptions({ timeoutMs: 30000 }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const idToken = tokenResponse.data.id_token;
    if (!idToken) {
      throw new AppError(400, "No id_token returned from token endpoint");
    }

    // SECURITY: Verify id_token signature using JWKS
    // This replaces the previous insecure jwt.decode() only verification
    const decoded = await service.verifyIdToken(idToken, issuer, clientId, {
      jwksUri: provider.jwksUri,
    });

    // A-68: the nonce binds this ID token to the sign-in THIS server started.
    // A token minted for another request (replayed, or injected with a stolen
    // code) carries another nonce, or none.
    if (decoded["nonce"] !== nonce) {
      throw new AppError(401, "id_token nonce does not match the sign-in request");
    }

    // The claims as the IdP sent them; the JavaScript read them unchecked.
    const claims = decoded as Record<string, string | undefined>;
    return {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" falls through to the next claim */
      email: (
        claims["email"] ||
        claims["preferred_username"] ||
        claims["upn"] ||
        ""
      ).toLowerCase(),
      firstName: claims["given_name"] || claims["name"]?.split(" ")[0] || "SSO",
      lastName: claims["family_name"] || "User",
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      // Include additional claims for audit
      nonce: decoded["nonce"],
      authTime: decoded["auth_time"],
      acr: decoded["acr"],
      amr: decoded["amr"],
      sub: decoded["sub"],
    };
  } catch (caught) {
    if (caught instanceof AppError) {
      logger.error("OIDC verification failed", {
        error: caught.message,
        issuer,
      });
      throw caught;
    }
    const err = caught as ErrorLike;
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
const discoveryCache = new JwksCache<OidcProvider>(DISCOVERY_TTL_MS);

/** An absolute http(s) URL, or null. */
const endpointUrl = (value: unknown): string | null => {
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
 * @param ssoSettings - the tenant's settings
 * @returns the authority
 * @throws {AppError} 400 when none is configured — there is no default: the
 *   old default was Entra's multi-tenant /common, refused below
 */
const authorityOf = (ssoSettings: OidcSettings): string => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: String() of the setting, "" when unset
  const authority = String(ssoSettings.oidc_authority || "").trim().replace(/\/+$/, "");
  if (!authority) {
    throw new AppError(400, "OIDC authority is not configured for this tenant");
  }
  return authority;
};

/** The discovery document's members this client reads. */
interface DiscoveryMetadata {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
}

/**
 * Resolve the identity provider's endpoints and issuer.
 *
 * @param ssoSettings - the tenant's settings (`oidc_authority`)
 * @returns the issuer and the three endpoints
 * @throws {AppError} 400 for an unusable configuration, 502 when the IdP
 *   cannot be read
 */
const discover = async (ssoSettings: OidcSettings): Promise<OidcProvider> => {
  const authority = authorityOf(ssoSettings);
  const base = authority.replace(/\/oauth2\/v2\.0$/i, "/v2.0");
  const metadataUrl = `${base}/.well-known/openid-configuration`;

  const cached = discoveryCache.get(metadataUrl);
  if (cached) {
    return cached;
  }

  // A-176: a 400 naming the setting, before anything is fetched.
  assertOutboundUrl(metadataUrl, "OIDC authority");

  let metadata: DiscoveryMetadata | null | undefined;
  try {
    const response = await axios.get<DiscoveryMetadata | null>(metadataUrl, {
      ...ssrfSafeAxiosOptions({ timeoutMs: 10000 }),
      headers: { Accept: "application/json", "User-Agent": "Callibrator-OIDC/1.0" },
    });
    metadata = response.data;
  } catch (caught) {
    const err = caught as ErrorLike;
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
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

  // Every member was checked non-null above.
  const complete = provider as OidcProvider;
  discoveryCache.set(metadataUrl, complete);
  return complete;
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get current JWKS info (for monitoring/debugging)
 * @param issuer - OIDC issuer URL
 * @returns JWKS metadata
 */
const getJwksInfo = async (
  issuer: string,
): Promise<{
  issuer: string;
  keyCount: number;
  keys: { kid: string | undefined; alg: string | undefined; use: string | undefined; keyOps: string[] | undefined }[];
}> => {
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
const clearCache = (): void => {
  jwksCache.clear();
  discoveryCache.clear();
  logger.info("JWKS cache cleared");
};

/**
 * Get cache stats
 */
const getCacheStats = (): { size: number; ttl: number } => {
  return {
    size: jwksCache.size(),
    ttl: jwksCache._ttl,
  };
};

const service = {
  verifyIdToken,
  verifyOidcCallback,
  discover,
  getJwksInfo,
  clearCache,
  getCacheStats,
};

export = service;
