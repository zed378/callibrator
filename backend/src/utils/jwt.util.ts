/**
 * JWT signing and verification: the access-key ring (S-26), single-purpose
 * tokens (A-59), and the legacy refresh token (A-31).
 *
 * P9-12 (ADR-087 Amendment 13): converted from jwt.util.js with no behaviour
 * change. `export =` keeps the exact object `require()` returned (the same keys,
 * in the same order, and no `__esModule` marker).
 */
import { createPublicKey, createSecretKey, randomBytes, type KeyObject } from "crypto";
import { decode, sign, verify, type Algorithm, type JwtHeader, type SignOptions } from "jsonwebtoken";
import { env, envOr } from "../config/env";
import { keyIdOf } from "./keyring.util";
import type { DecodedToken, TokenClaims, TokenPurpose } from "../types/auth";

// ==========================================
// ENV VALIDATION
// ==========================================

const CONFIGURED_ACCESS_SECRET = env("JWT_ACCESS_SECRET");
const CONFIGURED_REFRESH_SECRET = env("JWT_REFRESH_SECRET");

// Validate JWT secrets are configured at startup
if (!CONFIGURED_ACCESS_SECRET) {
  throw new Error("JWT_ACCESS_SECRET environment variable is required");
}

if (!CONFIGURED_REFRESH_SECRET) {
  throw new Error("JWT_REFRESH_SECRET environment variable is required");
}

// Past the two checks above, both are non-empty strings.
const ACCESS_SECRET: string = CONFIGURED_ACCESS_SECRET;
const REFRESH_SECRET: string = CONFIGURED_REFRESH_SECRET;

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
] as const satisfies readonly Algorithm[];

type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const isSupportedAlgorithm = (algorithm: string): algorithm is SupportedAlgorithm =>
  (SUPPORTED_ALGORITHMS as readonly string[]).includes(algorithm);

const CONFIGURED_ALGORITHM = envOr("JWT_ALGORITHM", "HS256");

if (!isSupportedAlgorithm(CONFIGURED_ALGORITHM)) {
  throw new Error(
    `JWT_ALGORITHM "${CONFIGURED_ALGORITHM}" is not supported. Use one of: ${SUPPORTED_ALGORITHMS.join(", ")}`,
  );
}

const JWT_ALGORITHM: SupportedAlgorithm = CONFIGURED_ALGORITHM;

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

const assertTokenType = (decoded: DecodedToken, expected: string): DecodedToken => {
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
const PURPOSE_TOKEN_TYPES: Readonly<Record<TokenPurpose, { ttl: TokenLifetime }>> = Object.freeze({
  activation: { ttl: "24h" },
  mfa: { ttl: "5m" },
  socket: { ttl: 300 },
  // P10-16 (ADR-099): a one-time password's first sign-in; bound to the
  // credential state by its `pf` claim, so it dies with the change it allows.
  "password-change": { ttl: "10m" },
});

/**
 * A lifetime as jsonwebtoken takes it: seconds, or an `ms` string ("15m").
 * jsonwebtoken validates the value when it signs, as it always has.
 */
type TokenLifetime = string | number;

/** Refuses a purpose the table above does not name (a JavaScript caller can pass anything). */
function assertPurposeType(typ: string): asserts typ is TokenPurpose {
  if (!Object.prototype.hasOwnProperty.call(PURPOSE_TOKEN_TYPES, typ)) {
    throw new Error(`Unknown token purpose "${typ}"`);
  }
}

const assertExactTokenType = (decoded: DecodedToken, expected: string): DecodedToken => {
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
// (utils/keyring.util); a token names the key that checks it. A token with
// no kid, or an unknown one (issued before S-26: "default"), is tried against
// each key. Nothing expires by the clock — a key leaves the ring when an
// operator removes it. The algorithm is JWT_ALGORITHM, always: there is no
// HS256 fallback. Rotating is: new key current, old key *_PREVIOUS, wait one
// access-token lifetime, remove *_PREVIOUS (docs/SECURITY/13-KEY-ROTATION.md).

const isAsymmetric = (algorithm: string): boolean => algorithm.startsWith("RS") || algorithm.startsWith("ES");

/** A verification key: an HS secret or a PEM string, or a public KeyObject. */
type VerificationMaterial = string | KeyObject;

interface RingKey {
  kid: string;
  key: VerificationMaterial;
}

/**
 * @param material - an HS secret, or a PEM (public or private)
 * @returns the key id: a fingerprint of the VERIFICATION key
 */
const kidOf = (material: string): string =>
  isAsymmetric(JWT_ALGORITHM)
    ? keyIdOf(createPublicKey(material).export({ type: "spki", format: "der" }))
    : keyIdOf(Buffer.from(material));

/**
 * U-06 (ADR-119): a ring key's material as the KeyObject jsonwebtoken would
 * make of it on every verify. Given a string, `verify` first tries
 * createPublicKey — which THROWS for an HS secret — and then createSecretKey,
 * on every authenticated request. The conversion is the same; it is done once.
 * @param material - an HS secret or a PEM, or a public KeyObject
 * @returns the KeyObject verify uses
 */
const keyObjectOf = (material: VerificationMaterial): KeyObject => {
  if (typeof material !== "string") {
    return material;
  }
  return isAsymmetric(JWT_ALGORITHM) ? createPublicKey(material) : createSecretKey(Buffer.from(material));
};

/** The last ring built, and the environment it was built from (U-06, ADR-119). */
let ringMemo: { source: string; ring: RingKey[] } | null = null;

/**
 * The keys a token may be verified with, current first.
 *
 * The ring is still the ENVIRONMENT, read on every call (S-26): it is rebuilt
 * whenever any of its variables differs from the last build, and reused
 * otherwise, so an operator's rotation applies on the next call as before.
 * What is reused is only the derived values: each key's id (a SHA-256 of the
 * material) and its KeyObject.
 * @returns the ring, current key first
 */
const verificationKeys = (): RingKey[] => {
  const privateKey = env("JWT_PRIVATE_KEY");
  const publicKey = env("JWT_PUBLIC_KEY");
  const publicKeyPrevious = env("JWT_PUBLIC_KEY_PREVIOUS");
  const secretPrevious = env("JWT_ACCESS_SECRET_PREVIOUS");
  const source = JSON.stringify([JWT_ALGORITHM, privateKey, publicKey, publicKeyPrevious, ACCESS_SECRET, secretPrevious]);
  if (ringMemo?.source === source) {
    return ringMemo.ring;
  }
  const materials: (VerificationMaterial | undefined)[] = isAsymmetric(JWT_ALGORITHM)
    ? [
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty JWT_PUBLIC_KEY also falls back
      publicKey ||
          (privateKey && createPublicKey(privateKey)),
      publicKeyPrevious,
    ]
    : [ACCESS_SECRET, secretPrevious];
  const ring = materials
    .filter((key): key is VerificationMaterial => Boolean(key))
    .map((key) => ({
      kid: typeof key === "string" ? kidOf(key) : keyIdOf(key.export({ type: "spki", format: "der" })),
      key: keyObjectOf(key),
    }));
  ringMemo = { source, ring };
  return ring;
};

// ==========================================
// ACCESS TOKEN
// ==========================================

/**
 * Sign with the current access key. Shared by access and purpose tokens.
 * @param signPayload - claims, `typ` already set
 * @param expiresIn - seconds, or an `ms` string
 * @returns the signed token
 */
const signWithAccessKey = (signPayload: TokenClaims, expiresIn: TokenLifetime): string => {
  // jsonwebtoken's typings accept only well-formed `ms` literals; the value is
  // an environment string, and jsonwebtoken refuses a malformed one at run time.
  const lifetime = expiresIn as NonNullable<SignOptions["expiresIn"]>;
  if (isAsymmetric(JWT_ALGORITHM)) {
    const privateKey = env("JWT_PRIVATE_KEY");
    if (!privateKey) {
      throw new Error(
        `Algorithm ${JWT_ALGORITHM} requires JWT_PRIVATE_KEY environment variable`,
      );
    }
    return sign(signPayload, privateKey, {
      expiresIn: lifetime,
      algorithm: JWT_ALGORITHM,
      keyid: kidOf(privateKey),
    });
  }

  return sign(signPayload, ACCESS_SECRET, {
    expiresIn: lifetime,
    algorithm: JWT_ALGORITHM,
    keyid: kidOf(ACCESS_SECRET),
  });
};

/** Per-call options for the token generators. */
interface TokenOptions {
  expiresIn?: TokenLifetime;
}

/**
 * @param payload - claims, or a user id
 * @param options - `{ expiresIn }`
 * @returns the signed access token
 */
const generateAccessToken = (payload: TokenClaims | string | number | null, options: TokenOptions = {}): string => {
  const basePayload =
    typeof payload === "object" && payload !== null ? payload : { id: payload };
  return signWithAccessKey(
    { ...basePayload, typ: TOKEN_TYPE_ACCESS },
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty or 0 expiresIn also falls back
    options.expiresIn || envOr("JWT_ACCESS_EXPIRED", "15m"),
  );
};

/**
 * A-59. Mint a single-purpose token (activation, mfa, socket). It is refused
 * by verifyAccessToken and accepted only by verifyPurposeToken for the same
 * type.
 *
 * @param payload - claims (identifiers only)
 * @param typ - "activation", "mfa" or "socket"
 * @param options - `{ expiresIn }`
 * @returns the signed purpose token
 */
const generatePurposeToken = (payload: TokenClaims, typ: TokenPurpose, options: TokenOptions = {}): string => {
  assertPurposeType(typ);
  return signWithAccessKey(
    { ...payload, typ },
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty or 0 expiresIn also falls back
    options.expiresIn || PURPOSE_TOKEN_TYPES[typ].ttl,
  );
};

// ==========================================
// OPAQUE REFRESH TOKEN
// ==========================================

const generateOpaqueRefreshToken = (): string => {
  return randomBytes(32).toString("hex");
};

// ==========================================
// REFRESH TOKEN (legacy)
// ==========================================

const generateRefreshToken = (payload: TokenClaims | string | number | null): string => {
  const basePayload =
    typeof payload === "object" && payload !== null ? payload : { id: payload };

  // The legacy JWT refresh token is symmetric and signed with REFRESH_SECRET,
  // whatever JWT_ALGORITHM says. Asymmetric algorithms and key rotation apply
  // to ACCESS tokens: the access-key ring holds ACCESS_SECRET, and signing refresh
  // tokens from it is what made the two interchangeable (A-31).
  //
  // Note that nothing in the login flow calls this — every refresh token this
  // application issues is opaque (generateOpaqueRefreshToken) and stored.
  return sign({ ...basePayload, typ: TOKEN_TYPE_REFRESH }, REFRESH_SECRET, {
    // See signWithAccessKey: an environment string, checked by jsonwebtoken.
    expiresIn: envOr("JWT_REFRESH_EXPIRED", "7d") as NonNullable<SignOptions["expiresIn"]>,
    algorithm: "HS256",
  });
};

// ==========================================
// VERIFY ACCESS TOKEN
// ==========================================

/** `err.name`, read exactly as the JavaScript did (jsonwebtoken throws Errors). */
const nameOf = (err: unknown): unknown => (err as { name?: unknown }).name;

/**
 * Verify against the access-key ring, then apply `checkType` to the payload.
 * Shared by access and purpose tokens.
 *
 * The key the token's `kid` names is tried; a token whose kid names no key
 * in the ring (or that has none) is tried against each. Always with the
 * pinned JWT_ALGORITHM. An expired token is reported as expired, not as
 * invalid.
 *
 * @param token - the token
 * @param checkType - throws on the wrong type
 * @param failureMessage - the message of every refusal but expiry
 * @returns the verified payload
 */
const verifyWithAccessKeys = (
  token: string,
  checkType: (decoded: DecodedToken) => DecodedToken,
  failureMessage: string,
): DecodedToken => {
  const keys = verificationKeys();
  const complete = decode(token, { complete: true });
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `(decoded || {}).header || {}`
  const header: Partial<JwtHeader> = (complete ? complete.header : undefined) || {};
  const named = keys.filter((k) => k.kid === header.kid);
  const candidates = named.length > 0 ? named : keys;

  for (const { key } of candidates) {
    let decoded: DecodedToken;
    try {
      decoded = verify(token, key, { algorithms: [JWT_ALGORITHM] });
    } catch (err) {
      if (nameOf(err) === "TokenExpiredError") {
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

const verifyAccessToken = (token: string): DecodedToken =>
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
 * @param token - the token
 * @param typ - "activation", "mfa" or "socket"
 * @returns the verified payload
 */
const verifyPurposeToken = (token: string, typ: TokenPurpose): DecodedToken => {
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

const verifyRefreshToken = (token: string): DecodedToken => {
  // Refresh tokens are verified against REFRESH_SECRET alone. They are not part
  // of the access-key ring — that ring holds ACCESS_SECRET, and
  // verifying a refresh token against it is what made the two interchangeable
  // (A-31). Note that every refresh token this application actually issues is
  // OPAQUE (generateOpaqueRefreshToken); this path exists for the legacy JWT
  // flavour and for callers outside the login flow.
  try {
    const decoded = verify(token, REFRESH_SECRET, {
      algorithms: ["HS256"],
    });
    return assertTokenType(decoded, TOKEN_TYPE_REFRESH);
  } catch (err) {
    if (nameOf(err) === "TokenExpiredError") {
      throw err;
    }
    throw new Error("Invalid or expired refresh token");
  }
};

// ==========================================
// KEY INFO (monitoring)
// ==========================================

/** What getKeyInfo reports. */
interface KeyInfo {
  keyId: string | null;
  algorithm: string;
  previousKeyIds: string[];
  keyCount: number;
}

/**
 * S-26: there is no in-process rotation. Rotating a JWT key is an operator
 * change to the environment (see the ring above); this only reports it.
 * @returns the current key id, the algorithm, the previous key ids and the count
 */
const getKeyInfo = (): KeyInfo => {
  const keys = verificationKeys();
  const [current] = keys;
  return {
    keyId: current ? current.kid : null,
    algorithm: JWT_ALGORITHM,
    previousKeyIds: keys.slice(1).map((k) => k.kid),
    keyCount: keys.length,
  };
};

/**
 * @returns every key id a token is currently verified against
 */
const getActiveKeyIds = (): string[] => verificationKeys().map((k) => k.kid);

// ==========================================
// DECODE
// ==========================================

const decodeToken = (token: string): DecodedToken | null => {
  return decode(token);
};

const generateToken = (payload: TokenClaims | string | number | null, options: TokenOptions = {}): string => {
  return generateAccessToken(payload, options);
};

const verifyToken = (token: string): DecodedToken => {
  return verifyAccessToken(token);
};

export = {
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
