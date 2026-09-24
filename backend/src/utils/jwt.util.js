const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { keyIdOf } = require("./keyring.util");

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

// ==========================================
// ACCESS-KEY RING (S-26)
// ==========================================
//
// Until S-26 this was a `JwtKeyRegistry`: an in-process Map seeded with one
// key whose `expiresAt` was process start + 30 days, a `rotateKey()` nothing
// called and nothing persisted, and a verifier that — once that one key had
// "expired" — fell back to ACCESS_SECRET with HS256 hard-coded. So every
// deployment that pinned HS384/HS512 or any RS*/ES* algorithm rejected every
// token after 30 days of uptime, and the "rotation support" was not rotation.
//
// Now the ring is the ENVIRONMENT, read when used, the same on every replica:
//
//   HS*        sign + verify: JWT_ACCESS_SECRET
//              verify only:   JWT_ACCESS_SECRET_PREVIOUS
//   RS* / ES*  sign:          JWT_PRIVATE_KEY
//              verify:        JWT_PUBLIC_KEY (or the public half of
//                             JWT_PRIVATE_KEY when unset)
//              verify only:   JWT_PUBLIC_KEY_PREVIOUS
//
// Every token carries `kid` = a fingerprint of its verification key
// (utils/keyring.util.js); a token names the key that checks it. A token with
// no kid, or an unknown one (issued before S-26: "default"), is tried against
// each key. Nothing expires by the clock — a key leaves the ring when an
// operator removes it. The algorithm is JWT_ALGORITHM, always: there is no
// HS256 fallback. Rotating is: new key current, old key *_PREVIOUS, wait one
// access-token lifetime, remove *_PREVIOUS (docs/SECURITY/13-KEY-ROTATION.md).

const isAsymmetric = (algorithm) => algorithm.startsWith("RS") || algorithm.startsWith("ES");

/**
 * @param {string} material - an HS secret, or a PEM (public or private)
 * @returns {string} the key id: a fingerprint of the VERIFICATION key
 */
const kidOf = (material) =>
  isAsymmetric(JWT_ALGORITHM)
    ? keyIdOf(crypto.createPublicKey(material).export({ type: "spki", format: "der" }))
    : keyIdOf(Buffer.from(material));

/**
 * The keys a token may be verified with, current first.
 * @returns {Array<{kid: string, key: string|object}>}
 */
const verificationKeys = () => {
  const materials = isAsymmetric(JWT_ALGORITHM)
    ? [
      process.env.JWT_PUBLIC_KEY ||
          (process.env.JWT_PRIVATE_KEY && crypto.createPublicKey(process.env.JWT_PRIVATE_KEY)),
      process.env.JWT_PUBLIC_KEY_PREVIOUS,
    ]
    : [ACCESS_SECRET, process.env.JWT_ACCESS_SECRET_PREVIOUS];
  return materials
    .filter(Boolean)
    .map((key) => ({
      kid: typeof key === "string" ? kidOf(key) : keyIdOf(key.export({ type: "spki", format: "der" })),
      key,
    }));
};

// ==========================================
// ACCESS TOKEN
// ==========================================

/**
 * Sign with the current access key. Shared by access and purpose tokens.
 * @param {object} signPayload - claims, `typ` already set
 * @param {string|number} expiresIn
 * @returns {string}
 */
const signWithAccessKey = (signPayload, expiresIn) => {
  if (isAsymmetric(JWT_ALGORITHM)) {
    const privateKey = process.env.JWT_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        `Algorithm ${JWT_ALGORITHM} requires JWT_PRIVATE_KEY environment variable`,
      );
    }
    return jwt.sign(signPayload, privateKey, {
      expiresIn,
      algorithm: JWT_ALGORITHM,
      keyid: kidOf(privateKey),
    });
  }

  return jwt.sign(signPayload, ACCESS_SECRET, {
    expiresIn,
    algorithm: JWT_ALGORITHM,
    keyid: kidOf(ACCESS_SECRET),
  });
};

/**
 * @param {object|string} payload - claims, or a user id
 * @param {{expiresIn?: string|number}} [options]
 * @returns {string}
 */
const generateAccessToken = (payload, options = {}) => {
  const basePayload =
    typeof payload === "object" && payload !== null ? payload : { id: payload };
  return signWithAccessKey(
    { ...basePayload, typ: TOKEN_TYPE_ACCESS },
    options.expiresIn || process.env.JWT_ACCESS_EXPIRED || "15m",
  );
};

/**
 * A-59. Mint a single-purpose token (activation, mfa, socket). It is refused
 * by verifyAccessToken and accepted only by verifyPurposeToken for the same
 * type.
 *
 * @param {object} payload - claims (identifiers only)
 * @param {"activation"|"mfa"|"socket"} typ
 * @param {{expiresIn?: string|number}} [options]
 * @returns {string}
 */
const generatePurposeToken = (payload, typ, options = {}) => {
  assertPurposeType(typ);
  return signWithAccessKey(
    { ...payload, typ },
    options.expiresIn || PURPOSE_TOKEN_TYPES[typ].ttl,
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
  // to ACCESS tokens: the access-key ring holds ACCESS_SECRET, and signing refresh
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
 * Verify against the access-key ring, then apply `checkType` to the payload.
 * Shared by access and purpose tokens.
 *
 * The key the token's `kid` names is tried; a token whose kid names no key
 * in the ring (or that has none) is tried against each. Always with the
 * pinned JWT_ALGORITHM. An expired token is reported as expired, not as
 * invalid.
 *
 * @param {string} token
 * @param {(decoded: object) => object} checkType - throws on the wrong type
 * @param {string} failureMessage
 * @returns {object}
 */
const verifyWithAccessKeys = (token, checkType, failureMessage) => {
  const keys = verificationKeys();
  const header = (jwt.decode(token, { complete: true }) || {}).header || {};
  const named = keys.filter((k) => k.kid === header.kid);
  const candidates = named.length > 0 ? named : keys;

  for (const { key } of candidates) {
    let decoded;
    try {
      decoded = jwt.verify(token, key, { algorithms: [JWT_ALGORITHM] });
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        throw err; // Don't suppress expiration errors
      }
      continue; // not this key
    }
    try {
      return checkType(decoded);
    } catch {
      throw new Error(failureMessage);
    }
  }
  throw new Error(failureMessage);
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
  // of the access-key ring — that ring holds ACCESS_SECRET, and
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
// KEY INFO (monitoring)
// ==========================================

/**
 * S-26: there is no in-process rotation. Rotating a JWT key is an operator
 * change to the environment (see the ring above); this only reports it.
 * @returns {{keyId: string|null, algorithm: string, previousKeyIds: string[], keyCount: number}}
 */
const getKeyInfo = () => {
  const keys = verificationKeys();
  return {
    keyId: keys.length ? keys[0].kid : null,
    algorithm: JWT_ALGORITHM,
    previousKeyIds: keys.slice(1).map((k) => k.kid),
    keyCount: keys.length,
  };
};

/**
 * @returns {string[]} every key id a token is currently verified against
 */
const getActiveKeyIds = () => verificationKeys().map((k) => k.kid);

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
  getKeyInfo,
  getActiveKeyIds,
};
