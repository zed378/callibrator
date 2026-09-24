/**
 * Tests for OIDC JWKS Service
 */

jest.mock("axios", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
jest.mock("jsonwebtoken", () => ({
  decode: jest.fn(),
  verify: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const crypto = require("crypto");
const oidcJwks = require("../../services/oidcJwks");

// Real public keys: the service converts JWK -> PEM with Node's crypto, so the
// fixtures must be real key material, not placeholder strings (a mock of the
// old jwk-to-pem package hid that the fixtures were not keys at all).
const RSA_JWK = crypto
  .generateKeyPairSync("rsa", { modulusLength: 2048 })
  .publicKey.export({ format: "jwk" });
const EC_JWK = crypto
  .generateKeyPairSync("ec", { namedCurve: "P-256" })
  .publicKey.export({ format: "jwk" });
const { AppError } = require("../../utils/appError.util");
const axios = require("axios");

// A-68: every callback verification carries the sign-in's stored nonce and PKCE
// verifier; the ID token must carry the same nonce.
const FLOW = Object.freeze({ nonce: "nonce-123", codeVerifier: "verifier-123" });
const jwt = require("jsonwebtoken");

// A-188: verifyOidcCallback resolves the IdP through discovery first. These
// suites are about the token exchange and the ID token, so the provider is
// given; discovery itself is tested in "A-188: provider discovery" below.
const PROVIDER = Object.freeze({
  issuer: "https://login.example.com/t1/v2.0",
  authorizationEndpoint: "https://login.example.com/t1/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.example.com/t1/oauth2/v2.0/token",
  jwksUri: "https://login.example.com/t1/discovery/v2.0/keys",
  discovered: true,
});
const useProvider = () => jest.spyOn(oidcJwks, "discover").mockResolvedValue(PROVIDER);

describe("oidcJwks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockReset();
    axios.post.mockReset();
    jwt.decode.mockReset();
    jwt.verify.mockReset();
    oidcJwks.clearCache();
  });

  describe("verifyIdToken", () => {
    it("should throw error when idToken is missing", async () => {
      await expect(
        oidcJwks.verifyIdToken(null, "https://issuer.com", "client-1"),
      ).rejects.toThrow("id_token is required");
    });

    it("should throw error when issuer is missing", async () => {
      await expect(
        oidcJwks.verifyIdToken("token", null, "client-1"),
      ).rejects.toThrow("OIDC issuer URL is required");
    });

    it("should throw error when clientId is missing", async () => {
      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", null),
      ).rejects.toThrow("OIDC client ID is required");
    });

    it("should throw error when idToken format is invalid", async () => {
      jwt.decode.mockReturnValue(null);

      await expect(
        oidcJwks.verifyIdToken(
          "invalid-token",
          "https://issuer.com",
          "client-1",
        ),
      ).rejects.toThrow("Invalid id_token format");
    });

    it("should throw error for unsupported algorithm", async () => {
      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "HS256" },
      });

      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", "client-1"),
      ).rejects.toThrow("Unsupported or insecure JWT algorithm");
    });

    it("should verify token with valid RS256 algorithm", async () => {
      const decodedToken = {
        sub: "user-1",
        email: "user@example.com",
        given_name: "John",
        family_name: "Doe",
      };

      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      jwt.verify.mockReturnValue(decodedToken);

      const result = await oidcJwks.verifyIdToken(
        "valid-token",
        "https://issuer.com",
        "client-1",
      );

      expect(result).toEqual(decodedToken);
      expect(axios.get).toHaveBeenCalledWith(
        "https://issuer.com/.well-known/jwks.json",
        expect.any(Object),
      );
    });

    it("should verify token with ES256 algorithm", async () => {
      const decodedToken = { sub: "user-1" };

      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "ES256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            { kid: "key-1", alg: "ES256", kty: "EC", crv: EC_JWK.crv, x: EC_JWK.x, y: EC_JWK.y },
          ],
        },
      });

      jwt.verify.mockReturnValue(decodedToken);

      const result = await oidcJwks.verifyIdToken(
        "token",
        "https://issuer.com",
        "client-1",
      );

      expect(result).toEqual(decodedToken);
    });

    it("should throw error when kid is missing from JWT header", async () => {
      jwt.decode.mockReturnValue({ header: { alg: "RS256" } });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", "client-1"),
      ).rejects.toThrow("JWT missing 'kid' header");
    });

    it("should throw error when no matching key found for kid", async () => {
      jwt.decode.mockReturnValue({
        header: { kid: "unknown-key", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", "client-1"),
      ).rejects.toThrow(
        "No matching public key found for JWT with kid: unknown-key",
      );
    });

    it("should use cached JWKS on subsequent calls", async () => {
      const decodedToken = { sub: "user-1" };

      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      jwt.verify.mockReturnValue(decodedToken);

      // First call - fetches JWKS
      await oidcJwks.verifyIdToken("token-1", "https://issuer.com", "client-1");

      // Second call - should use cache
      await oidcJwks.verifyIdToken("token-2", "https://issuer.com", "client-1");

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it("should throw TokenExpiredError as AppError", async () => {
      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      const TokenExpiredError = new Error("token expired");
      TokenExpiredError.name = "TokenExpiredError";
      jwt.verify.mockImplementationOnce(() => {
        throw TokenExpiredError;
      });

      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", "client-1"),
      ).rejects.toThrow("id_token has expired");
    });

    it("should throw JsonWebTokenError as AppError", async () => {
      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      const JsonWebTokenError = new Error("invalid token");
      JsonWebTokenError.name = "JsonWebTokenError";
      jwt.verify.mockImplementationOnce(() => {
        throw JsonWebTokenError;
      });

      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", "client-1"),
      ).rejects.toThrow("Invalid id_token signature");
    });
  });

  describe("verifyOidcCallback", () => {
    beforeEach(useProvider);

    it("should throw error when no id_token returned", async () => {
      axios.post.mockResolvedValueOnce({ data: {} });

      await expect(
        oidcJwks.verifyOidcCallback(
          "auth-code",
          {},
          "http://localhost/callback",
          FLOW,
        ),
      ).rejects.toThrow("No id_token returned from token endpoint");
    });

    it("should return user info from decoded token", async () => {
      const decodedToken = {
        email: "USER@Example.com",
        preferred_username: null,
        upn: null,
        given_name: "John",
        name: "John Doe",
        family_name: "Doe",
        nonce: "nonce-123",
        auth_time: 1234567890,
        acr: "urn:mace:incommon:iap:silver",
        amr: ["pwd"],
        sub: "user-123",
      };

      axios.post.mockResolvedValueOnce({
        data: { id_token: "valid-token" },
      });

      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      jwt.verify.mockReturnValue(decodedToken);

      const ssoSettings = {
        oidc_client_id: "client-1",
        oidc_client_secret: "secret",
        oidc_authority: "https://login.microsoftonline.com/common/oauth2/v2.0",
      };

      const result = await oidcJwks.verifyOidcCallback(
        "auth-code",
        ssoSettings,
        "http://localhost/callback",
        FLOW,
      );

      expect(result.email).toBe("user@example.com");
      expect(result.firstName).toBe("John");
      expect(result.lastName).toBe("Doe");
      expect(result.nonce).toBe("nonce-123");
      expect(result.sub).toBe("user-123");
    });

    it("should use default values when name fields are missing", async () => {
      const decodedToken = {
        email: "test@example.com",
        nonce: FLOW.nonce,
      };

      axios.post.mockResolvedValueOnce({
        data: { id_token: "valid-token" },
      });

      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              kty: "RSA",
              n: RSA_JWK.n,
              e: RSA_JWK.e,
            },
          ],
        },
      });

      jwt.verify.mockReturnValue(decodedToken);

      const ssoSettings = {
        oidc_client_id: "client-1",
        oidc_client_secret: "secret",
      };

      const result = await oidcJwks.verifyOidcCallback(
        "auth-code",
        ssoSettings,
        "http://localhost/callback",
        FLOW,
      );

      expect(result.email).toBe("test@example.com");
      expect(result.firstName).toBe("SSO");
      expect(result.lastName).toBe("User");
    });

    it("should throw AppError on OIDC verification failure", async () => {
      axios.post.mockResolvedValueOnce({
        data: { id_token: "invalid-token" },
      });

      jwt.decode.mockReturnValue({
        header: { kid: "key-1", alg: "RS256" },
      });

      axios.get.mockRejectedValueOnce(new Error("Network error"));

      const ssoSettings = {
        oidc_client_id: "client-1",
        oidc_client_secret: "secret",
        oidc_authority: "https://login.microsoftonline.com/common/oauth2/v2.0",
      };

      await expect(
        oidcJwks.verifyOidcCallback(
          "auth-code",
          ssoSettings,
          "http://localhost/callback",
          FLOW,
        ),
      ).rejects.toThrow("Failed to fetch IdP public keys");
    });
  });

  describe("getJwksInfo", () => {
    it("should return JWKS metadata", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          keys: [
            {
              kid: "key-1",
              alg: "RS256",
              use: "sig",
              key_ops: ["verify"],
              kty: "RSA",
            },
            {
              kid: "key-2",
              alg: "ES256",
              use: "sig",
              kty: "EC",
            },
          ],
        },
      });

      const result = await oidcJwks.getJwksInfo("https://issuer.com");

      expect(result.issuer).toBe("https://issuer.com");
      expect(result.keyCount).toBe(2);
      expect(result.keys).toHaveLength(2);
      expect(result.keys[0]).toEqual({
        kid: "key-1",
        alg: "RS256",
        use: "sig",
        keyOps: ["verify"],
      });
    });
  });

  describe("clearCache", () => {
    it("should clear the JWKS cache", () => {
      oidcJwks.clearCache();
      const stats = oidcJwks.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("getCacheStats", () => {
    it("should return cache statistics", () => {
      const stats = oidcJwks.getCacheStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("ttl");
      expect(typeof stats.size).toBe("number");
      expect(typeof stats.ttl).toBe("number");
    });
  });

  // ================================================================
  // Coverage: cache TTL expiry, JWKS shape validation, error branches
  // ================================================================
  describe("JWKS cache TTL", () => {
    const validJwks = { keys: [{ kid: "k1", kty: "RSA", n: RSA_JWK.n, e: RSA_JWK.e }] };

    it("serves the second call from cache without re-fetching", async () => {
      axios.get.mockResolvedValue({ data: validJwks });

      await oidcJwks.getJwksInfo("https://issuer.com");
      await oidcJwks.getJwksInfo("https://issuer.com");

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(oidcJwks.getCacheStats().size).toBe(1);
    });

    it("re-fetches once the cached entry has passed its TTL", async () => {
      axios.get.mockResolvedValue({ data: validJwks });
      const { ttl } = oidcJwks.getCacheStats();
      const realNow = Date.now;

      try {
        const t0 = realNow.call(Date);
        Date.now = jest.fn(() => t0);
        await oidcJwks.getJwksInfo("https://issuer.com");
        expect(axios.get).toHaveBeenCalledTimes(1);

        // Jump just past the TTL — the entry must be evicted and re-fetched.
        Date.now = jest.fn(() => t0 + ttl + 1);
        await oidcJwks.getJwksInfo("https://issuer.com");
        expect(axios.get).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = realNow;
      }
    });

    it("normalizes a trailing slash on the issuer before building the JWKS URL", async () => {
      axios.get.mockResolvedValue({ data: validJwks });

      await oidcJwks.getJwksInfo("https://issuer.com/");

      expect(axios.get).toHaveBeenCalledWith(
        "https://issuer.com/.well-known/jwks.json",
        expect.any(Object),
      );
    });
  });

  describe("fetchJwks response validation", () => {
    it("rejects a response with no body", async () => {
      axios.get.mockResolvedValue({ data: null });

      await expect(oidcJwks.getJwksInfo("https://issuer.com")).rejects.toMatchObject({
        status: 500,
        message: "Invalid JWKS response from IdP",
      });
    });

    it("rejects a response whose keys field is not an array", async () => {
      axios.get.mockResolvedValue({ data: { keys: "nope" } });

      await expect(oidcJwks.getJwksInfo("https://issuer.com")).rejects.toMatchObject({
        status: 500,
        message: "Invalid JWKS response from IdP",
      });
    });

    it("rejects a response with an empty keys array", async () => {
      axios.get.mockResolvedValue({ data: { keys: [] } });

      await expect(oidcJwks.getJwksInfo("https://issuer.com")).rejects.toMatchObject({
        status: 500,
        message: "Invalid JWKS response from IdP",
      });
    });

    it("maps an HTTP error response to a 500 and does not cache it", async () => {
      const httpErr = new Error("Request failed with status code 404");
      httpErr.response = { status: 404, data: { error: "not_found" } };
      axios.get.mockRejectedValue(httpErr);

      await expect(oidcJwks.getJwksInfo("https://issuer.com")).rejects.toMatchObject({
        status: 500,
        message: "Failed to fetch IdP public keys",
      });

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        "JWKS fetch failed",
        expect.objectContaining({ status: 404 }),
      );
      expect(oidcJwks.getCacheStats().size).toBe(0);
    });

    it("maps a network error (no response) to a 500", async () => {
      axios.get.mockRejectedValue(new Error("ETIMEDOUT"));

      await expect(oidcJwks.getJwksInfo("https://issuer.com")).rejects.toMatchObject({
        status: 500,
        message: "Failed to fetch IdP public keys",
      });

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        "JWKS fetch error",
        expect.objectContaining({ error: "ETIMEDOUT" }),
      );
    });
  });

  describe("verifyIdToken unexpected errors", () => {
    it("rethrows an error that is neither an AppError nor a JWT error", async () => {
      jwt.decode.mockReturnValue({ header: { kid: "k1", alg: "RS256" } });
      axios.get.mockResolvedValue({
        data: { keys: [{ kid: "k1", kty: "RSA", n: RSA_JWK.n, e: RSA_JWK.e }] },
      });
      const boom = new TypeError("jwkToPem exploded");
      jwt.verify.mockImplementation(() => {
        throw boom;
      });

      await expect(
        oidcJwks.verifyIdToken("token", "https://issuer.com", "client-1"),
      ).rejects.toBe(boom);
    });
  });

  describe("verifyOidcCallback unexpected errors", () => {
    beforeEach(useProvider);

    it("maps a non-AppError token-exchange failure to a 401", async () => {
      const netErr = new Error("socket hang up");
      netErr.response = { data: { error: "invalid_grant" } };
      axios.post.mockRejectedValue(netErr);

      await expect(
        oidcJwks.verifyOidcCallback(
          "code-1",
          { oidc_client_id: "c1", oidc_client_secret: "s1" },
          "https://sp/callback",
          FLOW,
        ),
      ).rejects.toMatchObject({ status: 401, message: "OIDC authentication failed" });

      const { logger } = require("../../middlewares/activityLog.middleware");
      expect(logger.error).toHaveBeenCalledWith(
        "OIDC verification error",
        expect.objectContaining({
          error: "socket hang up",
          response: { error: "invalid_grant" },
        }),
      );
    });

    it("maps a non-AppError failure with no response payload to a 401", async () => {
      axios.post.mockRejectedValue(new Error("boom"));

      await expect(
        oidcJwks.verifyOidcCallback(
          "code-1",
          { oidc_client_id: "c1", oidc_client_secret: "s1" },
          "https://sp/callback",
          FLOW,
        ),
      ).rejects.toMatchObject({ status: 401, message: "OIDC authentication failed" });
    });
  });

  describe("verifyOidcCallback email claim fallback chain", () => {
    beforeEach(useProvider);

    const settings = { oidc_client_id: "c1", oidc_client_secret: "s1" };

    // Drives the real verifyIdToken path up to jwt.verify, which returns `claims`.
    const withClaims = (claims) => {
      axios.post.mockResolvedValue({ data: { id_token: "tok" } });
      jwt.decode.mockReturnValue({ header: { kid: "k1", alg: "RS256" } });
      axios.get.mockResolvedValue({
        data: { keys: [{ kid: "k1", kty: "RSA", n: RSA_JWK.n, e: RSA_JWK.e }] },
      });
      jwt.verify.mockReturnValue({ nonce: FLOW.nonce, ...claims });
    };

    it("falls back to preferred_username when email is absent", async () => {
      withClaims({ preferred_username: "Bob@Example.COM" });

      const result = await oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW);

      expect(result.email).toBe("bob@example.com");
    });

    it("falls back to upn when email and preferred_username are absent", async () => {
      withClaims({ upn: "Carol@Example.COM" });

      const result = await oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW);

      expect(result.email).toBe("carol@example.com");
    });

    it("yields an empty email when no email-ish claim is present", async () => {
      withClaims({ sub: "abc" });

      const result = await oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW);

      expect(result.email).toBe("");
    });

    it("derives firstName from the name claim when given_name is absent", async () => {
      withClaims({ email: "d@e.com", name: "Dave Smith" });

      const result = await oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW);

      expect(result.firstName).toBe("Dave");
      expect(result.lastName).toBe("User");
    });

    it("defaults firstName/lastName when neither given_name nor name is present", async () => {
      withClaims({ email: "d@e.com" });

      const result = await oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW);

      expect(result.firstName).toBe("SSO");
      expect(result.lastName).toBe("User");
    });

    it("passes through the audit claims", async () => {
      withClaims({
        email: "d@e.com",
        given_name: "Dave",
        family_name: "Smith",
        nonce: FLOW.nonce,
        auth_time: 1700000000,
        acr: "1",
        amr: ["pwd"],
        sub: "sub-1",
      });

      const result = await oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW);

      expect(result).toEqual({
        email: "d@e.com",
        firstName: "Dave",
        lastName: "Smith",
        nonce: FLOW.nonce,
        authTime: 1700000000,
        acr: "1",
        amr: ["pwd"],
        sub: "sub-1",
      });
    });

    it("A-188: posts to the discovered token_endpoint and checks the discovered issuer and keys", async () => {
      withClaims({ email: "d@e.com" });

      await oidcJwks.verifyOidcCallback("code-9", settings, "https://cb", FLOW);

      expect(axios.post).toHaveBeenCalledWith(
        PROVIDER.tokenEndpoint,
        expect.stringContaining("code=code-9"),
        expect.any(Object),
      );
      expect(axios.get).toHaveBeenCalledWith(PROVIDER.jwksUri, expect.any(Object));
      expect(jwt.verify).toHaveBeenCalledWith(
        "tok",
        expect.any(String),
        expect.objectContaining({ issuer: PROVIDER.issuer, audience: "c1" }),
      );
    });
  });

  describe("A-68: nonce and PKCE", () => {
    beforeEach(useProvider);

    const settings = { oidc_client_id: "c1", oidc_client_secret: "s1" };
    const withClaims = (claims) => {
      axios.post.mockResolvedValue({ data: { id_token: "tok" } });
      jwt.decode.mockReturnValue({ header: { kid: "k1", alg: "RS256" } });
      axios.get.mockResolvedValue({
        data: { keys: [{ kid: "k1", kty: "RSA", n: RSA_JWK.n, e: RSA_JWK.e }] },
      });
      jwt.verify.mockReturnValue(claims);
    };

    it.each([
      ["no flow at all", undefined],
      ["no nonce", { codeVerifier: "v" }],
      ["no code_verifier", { nonce: "n" }],
    ])("refuses a callback with %s before any request to the IdP", async (_label, flow) => {
      await expect(
        oidcJwks.verifyOidcCallback("c", settings, "https://cb", flow),
      ).rejects.toMatchObject({ status: 401, message: "OIDC sign-in state is incomplete" });
      expect(axios.post).not.toHaveBeenCalled();
    });

    it("sends the PKCE code_verifier to the token endpoint", async () => {
      withClaims({ email: "d@e.com", nonce: FLOW.nonce });

      await oidcJwks.verifyOidcCallback("code-9", settings, "https://cb", FLOW);

      const body = new URLSearchParams(axios.post.mock.calls[0][1]);
      expect(body.get("code_verifier")).toBe(FLOW.codeVerifier);
      expect(body.get("code")).toBe("code-9");
    });

    it("an id_token whose nonce does not match the sign-in is refused", async () => {
      withClaims({ email: "d@e.com", nonce: "someone-elses-nonce" });

      await expect(
        oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW),
      ).rejects.toMatchObject({
        status: 401,
        message: "id_token nonce does not match the sign-in request",
      });
    });

    it("an id_token with no nonce is refused", async () => {
      withClaims({ email: "d@e.com" });

      await expect(
        oidcJwks.verifyOidcCallback("c", settings, "https://cb", FLOW),
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});
