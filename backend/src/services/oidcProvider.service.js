const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const { TenantSettings, Users } = require("../models");
const { AppError } = require("../utils/appError.util");
const redis = require("./redis.service");

const OIDC_ISSUER = process.env.OIDC_ISSUER || "http://localhost:5000";
const OIDC_JWKS_KID = process.env.OIDC_JWKS_KID || "callibrator-oidc-key-1";
// Where /oidc/authorize sends the browser to authenticate + consent.
const OIDC_CONSENT_URL =
  process.env.OIDC_CONSENT_URL || "http://localhost:3000/oauth/consent";

// Redis key namespaces for the short-lived authorization-code flow artifacts.
const authReqKey = (id) => `oidc:authreq:${id}`;
const codeKey = (code) => `oidc:code:${code}`;
const refreshKey = (token) => `oidc:refresh:${token}`;
const AUTH_REQUEST_TTL = 600; // 10 min to log in + consent
const AUTH_CODE_TTL = 300; // 5 min to exchange
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days

const b64url = (buf) =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** PKCE: verify a code_verifier against a stored challenge (S256 or plain). */
function verifyPkce(codeVerifier, codeChallenge, method) {
  /* istanbul ignore next -- defensive: the only caller (authenticateClient)
     already gates on codeChallenge being present, so this is unreachable. */
  if (!codeChallenge) return true; // no PKCE was requested
  if (!codeVerifier) return false;
  const computed =
    method === "plain"
      ? codeVerifier
      : b64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * TenantSettings key prefix for clients registered against THIS server's OIDC
 * provider.
 *
 * Deliberately not "oidc_client_": the SSO feature already stores an
 * (encrypted, non-JSON) setting called `oidc_client_secret`, which a
 * `LIKE 'oidc_client_%'` scan picked up and then tried to JSON.parse — 500ing
 * GET /oidc/clients. Note `_` is also a single-char wildcard in SQL LIKE, so
 * the two namespaces could never be separated by escaping alone.
 */
const CLIENT_KEY_PREFIX = "oidc_rp_";
const clientKey = (clientId) => `${CLIENT_KEY_PREFIX}${clientId}`;

function generateRsaKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

const keyPair = generateRsaKeyPair();

const getPublicKey = () => keyPair.publicKey;
const getPrivateKey = () => keyPair.privateKey;

/**
 * Build the public JWKS.
 *
 * This delegates to Node's own SPKI->JWK export instead of walking the DER by
 * hand. The previous hand-rolled parser had three defects, all fixed here:
 *
 *  1. SECURITY: `new DataView(der.buffer)` ignored `der.byteOffset`. Buffers
 *     under 4KB are slices of Node's shared 64KB pool, so the parser read from
 *     the START OF THE POOL — i.e. whatever unrelated Buffer happened to live
 *     there — and published it as the modulus on the PUBLIC, unauthenticated
 *     /oidc/.well-known/jwks.json endpoint. That leaked adjacent heap memory.
 *  2. `readLen()` returned the NUMBER OF LENGTH BYTES for long-form lengths
 *     rather than the decoded length, so the walk was misaligned anyway.
 *  3. `n`/`e` were hex-encoded; RFC 7517 requires base64url (`e` must be
 *     "AQAB", not "010001"), so no relying party could verify a token.
 *
 * crypto.createPublicKey().export({ format: "jwk" }) returns correctly
 * base64url-encoded { kty, n, e }.
 */
function buildJwks() {
  const { kty, n, e } = crypto
    .createPublicKey(getPublicKey())
    .export({ format: "jwk" });

  return {
    keys: [
      {
        kty,
        use: "sig",
        kid: OIDC_JWKS_KID,
        alg: "RS256",
        n,
        e,
      },
    ],
  };
}

function signToken(payload, expiresIn) {
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: "RS256",
    expiresIn,
    issuer: OIDC_ISSUER,
    keyid: OIDC_JWKS_KID,
  });
}

/** Read a stored client record, tolerating a corrupt or foreign (non-JSON) row. */
function parseClientSetting(setting) {
  try {
    const data = JSON.parse(setting.value || "{}");
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

exports.discover = () => ({
  issuer: OIDC_ISSUER,
  authorization_endpoint: `${OIDC_ISSUER}/oidc/authorize`,
  token_endpoint: `${OIDC_ISSUER}/oidc/token`,
  userinfo_endpoint: `${OIDC_ISSUER}/oidc/userinfo`,
  jwks_uri: `${OIDC_ISSUER}/oidc/.well-known/jwks.json`,
  scopes_supported: ["openid", "profile", "email", "offline_access"],
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
});

exports.jwks = () => buildJwks();

exports.registerClient = async (tenantId, data) => {
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomBytes(32).toString("hex");
  const hashedSecret = crypto.createHash("sha256").update(clientSecret).digest("hex");

  const scopes = data.scopes || ["openid", "profile", "email"];
  const grantTypes = data.grantTypes || ["authorization_code"];

  await TenantSettings.upsert({
    tenantId,
    key: clientKey(clientId),
    value: JSON.stringify({
      clientId,
      clientSecretHash: hashedSecret,
      name: data.name,
      redirectUris: data.redirectUris || [],
      scopes,
      grantTypes,
      createdAt: new Date(),
    }),
  });

  // The plaintext secret is returned exactly once; only the hash is stored.
  return {
    clientId,
    clientSecret,
    name: data.name,
    redirectUris: data.redirectUris || [],
    scopes,
    grantTypes,
  };
};

exports.getClients = async (tenantId) => {
  const settings = await TenantSettings.findAll({
    where: { tenantId, key: { [Op.like]: `${CLIENT_KEY_PREFIX}%` } },
  });

  return settings
    .map(parseClientSetting)
    // A row without a clientId is not one of ours — skip rather than 500.
    .filter((data) => data && data.clientId)
    .map((data) => ({
      clientId: data.clientId,
      name: data.name,
      redirectUris: data.redirectUris,
      scopes: data.scopes,
      grantTypes: data.grantTypes,
      createdAt: data.createdAt,
    }));
};

exports.rotateSecret = async (tenantId, clientId) => {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: clientKey(clientId) },
  });

  if (!setting) {
    throw new AppError(404, "OIDC client not found");
  }

  const newSecret = crypto.randomBytes(32).toString("hex");
  const hashedSecret = crypto.createHash("sha256").update(newSecret).digest("hex");

  const data = JSON.parse(setting.value || "{}");
  data.clientSecretHash = hashedSecret;
  data.rotatedAt = new Date();

  await TenantSettings.update(
    { value: JSON.stringify(data) },
    { where: { tenantId, key: clientKey(clientId) } },
  );

  return { clientId, clientSecret: newSecret };
};

exports.deleteClient = async (tenantId, clientId) => {
  const deleted = await TenantSettings.destroy({
    where: { tenantId, key: clientKey(clientId) },
  });

  return { deleted: deleted > 0 };
};

exports.issueTokens = async (
  tenantId,
  user,
  scopes = ["openid", "profile", "email"],
  opts = {},
) => {
  const scope = scopes.join(" ");
  const accessToken = signToken(
    {
      sub: user.id,
      email: user.email,
      tenant_id: tenantId,
      scope,
      typ: "access",
    },
    "15m",
  );

  // No `iat`/`exp`/`iss` in the payload: signToken already passes
  // expiresIn + issuer, and jsonwebtoken REFUSES to sign when the payload
  // carries its own `exp` alongside options.expiresIn.
  const idToken = signToken(
    {
      sub: user.id,
      email: user.email,
      given_name: user.firstName,
      family_name: user.lastName,
      tenant_id: tenantId,
      scope,
      // `aud` MUST be the relying party's client_id. Fall back to the email
      // only for legacy/internal callers that mint outside the client flow.
      aud: opts.clientId || user.email,
      ...(opts.nonce ? { nonce: opts.nonce } : {}),
    },
    "15m",
  );

  const refreshToken = crypto.randomBytes(64).toString("hex");
  // Persist the refresh token so the refresh_token grant can validate + rotate it.
  await redis.set(
    refreshKey(refreshToken),
    { tenantId, userId: user.id, clientId: opts.clientId || null, scope },
    REFRESH_TTL,
  );

  return {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 900,
    scope,
  };
};

exports.verifySecret = async (tenantId, clientId, clientSecret) => {
  const setting = await TenantSettings.findOne({
    where: { tenantId, key: clientKey(clientId) },
  });

  if (!setting) {
    return false;
  }

  const data = parseClientSetting(setting);
  if (!data || !data.clientSecretHash) {
    return false;
  }

  const hashed = Buffer.from(
    crypto.createHash("sha256").update(clientSecret).digest("hex"),
    "hex",
  );
  const stored = Buffer.from(data.clientSecretHash, "hex");

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (hashed.length !== stored.length) {
    return false;
  }
  return crypto.timingSafeEqual(hashed, stored);
};

// ==========================================================================
// AUTHORIZATION CODE FLOW
// ==========================================================================

/**
 * Look up a registered client by client_id across every tenant. client_id is a
 * globally-unique UUID, so the (tenant_id, key) row is unambiguous.
 */
exports.findClientByClientId = async (clientId) => {
  if (!clientId) return null;
  const setting = await TenantSettings.findOne({
    where: { key: clientKey(clientId) },
  });
  if (!setting) return null;
  const data = parseClientSetting(setting);
  if (!data || !data.clientId) return null;
  return { ...data, tenantId: setting.tenantId };
};

/**
 * Validate an /authorize request and stage it in Redis. Returns the consent URL
 * to send the browser to. HARD failures (unknown client / unregistered
 * redirect_uri / bad response_type) throw — we must NEVER redirect to an
 * unvalidated redirect_uri, and must not leak them via the error channel.
 */
exports.beginAuthorization = async (params) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    nonce,
    code_challenge,
    code_challenge_method,
  } = params;

  const client = await exports.findClientByClientId(client_id);
  if (!client) {
    throw new AppError(400, "Unknown client_id");
  }
  if (!redirect_uri || !(client.redirectUris || []).includes(redirect_uri)) {
    throw new AppError(400, "redirect_uri is not registered for this client");
  }
  if (response_type !== "code") {
    throw new AppError(400, "Only response_type=code is supported");
  }
  const method = code_challenge_method || (code_challenge ? "S256" : null);
  if (code_challenge && !["S256", "plain"].includes(method)) {
    throw new AppError(400, "Unsupported code_challenge_method");
  }

  const requestId = b64url(crypto.randomBytes(24));
  const requestedScope = (scope || "openid").split(/\s+/).filter(Boolean);
  await redis.set(
    authReqKey(requestId),
    {
      clientId: client.clientId,
      clientName: client.name,
      tenantId: client.tenantId,
      redirectUri: redirect_uri,
      scope: requestedScope,
      state: state || null,
      nonce: nonce || null,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge ? method : null,
    },
    AUTH_REQUEST_TTL,
  );

  return {
    requestId,
    consentUrl: `${OIDC_CONSENT_URL}?request=${encodeURIComponent(requestId)}`,
  };
};

/** The consent screen reads the staged request to show the client + scopes. */
exports.getAuthRequest = async (requestId) => {
  const req = requestId ? await redis.get(authReqKey(requestId)) : null;
  if (!req) return null;
  return {
    clientName: req.clientName,
    scope: req.scope,
    redirectUri: req.redirectUri,
  };
};

/**
 * The authenticated user's consent decision. `approve` mints a single-use code
 * bound to {client, user, redirect, scope, nonce, PKCE}; returns the redirect
 * target (with the code, or an access_denied error).
 */
exports.decideAuthorization = async (requestId, user, approve) => {
  const req = requestId ? await redis.get(authReqKey(requestId)) : null;
  if (!req) {
    throw new AppError(400, "Authorization request expired or invalid");
  }
  await redis.del(authReqKey(requestId));

  const params = new URLSearchParams();
  if (req.state) {
    params.set("state", req.state);
  }

  if (!approve) {
    params.set("error", "access_denied");
    return { redirectTo: `${req.redirectUri}?${params.toString()}` };
  }

  const code = b64url(crypto.randomBytes(32));
  await redis.set(
    codeKey(code),
    {
      clientId: req.clientId,
      tenantId: req.tenantId,
      userId: user.id,
      redirectUri: req.redirectUri,
      scope: req.scope,
      nonce: req.nonce,
      codeChallenge: req.codeChallenge,
      codeChallengeMethod: req.codeChallengeMethod,
    },
    AUTH_CODE_TTL,
  );

  params.set("code", code);
  return { redirectTo: `${req.redirectUri}?${params.toString()}` };
};

/** Authenticate a client at the token endpoint: PKCE code_verifier OR client_secret. */
async function authenticateClient(codeData, { clientId, clientSecret, codeVerifier }) {
  if (codeData.clientId !== clientId) {
    return false;
  }
  if (codeData.codeChallenge) {
    return verifyPkce(codeVerifier, codeData.codeChallenge, codeData.codeChallengeMethod);
  }
  // No PKCE ⇒ a confidential client must present its secret.
  return exports.verifySecret(codeData.tenantId, clientId, clientSecret || "");
}

/** Token endpoint — authorization_code grant. */
exports.exchangeAuthorizationCode = async ({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
}) => {
  const codeData = code ? await redis.get(codeKey(code)) : null;
  if (!codeData) {
    throw new AppError(400, "invalid_grant: code is invalid or expired");
  }
  await redis.del(codeKey(code)); // single-use

  if (redirectUri !== codeData.redirectUri) {
    throw new AppError(400, "invalid_grant: redirect_uri mismatch");
  }
  const ok = await authenticateClient(codeData, { clientId, clientSecret, codeVerifier });
  if (!ok) {
    throw new AppError(401, "invalid_client");
  }

  const user = await Users.findByPk(codeData.userId);
  if (!user) {
    throw new AppError(400, "invalid_grant: user no longer exists");
  }

  return exports.issueTokens(codeData.tenantId, user, codeData.scope, {
    clientId,
    nonce: codeData.nonce,
  });
};

/** Token endpoint — refresh_token grant (rotates the refresh token). */
exports.refreshAccessToken = async ({ refreshToken, clientId, clientSecret }) => {
  const data = refreshToken ? await redis.get(refreshKey(refreshToken)) : null;
  if (!data) {
    throw new AppError(400, "invalid_grant: refresh token is invalid or expired");
  }
  if (data.clientId !== clientId) {
    throw new AppError(401, "invalid_client");
  }
  const ok = await exports.verifySecret(data.tenantId, clientId, clientSecret || "");
  if (!ok) {
    throw new AppError(401, "invalid_client");
  }

  await redis.del(refreshKey(refreshToken)); // rotate
  const user = await Users.findByPk(data.userId);
  if (!user) {
    throw new AppError(400, "invalid_grant: user no longer exists");
  }

  return exports.issueTokens(data.tenantId, user, data.scope.split(" "), { clientId });
};

/** Userinfo endpoint — verify the access-token JWT and return scoped claims. */
exports.getUserInfo = async (accessToken) => {
  let payload;
  try {
    payload = jwt.verify(accessToken, getPublicKey(), {
      algorithms: ["RS256"],
      issuer: OIDC_ISSUER,
    });
  } catch {
    throw new AppError(401, "invalid_token");
  }
  const scopes = (payload.scope || "").split(" ");
  const claims = { sub: payload.sub };
  if (scopes.includes("email")) {
    claims.email = payload.email;
  }
  if (scopes.includes("profile")) {
    const user = await Users.findByPk(payload.sub);
    if (user) {
      claims.given_name = user.firstName;
      claims.family_name = user.lastName;
      claims.name =
        [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
    }
  }
  return claims;
};
