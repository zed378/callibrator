jest.mock("../../models", () => ({
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
  Users: {
    findByPk: jest.fn(),
  },
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(true),
  del: jest.fn().mockResolvedValue(true),
}));

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");

const oidc = require("../../services/oidcProvider.service");
const { TenantSettings, Users } = require("../../models");
const redis = require("../../services/redis.service");

describe("oidcProvider.service", () => {
  beforeEach(() => jest.clearAllMocks());

  it("discover returns OIDC metadata", () => {
    const result = oidc.discover();
    expect(result.issuer).toBeDefined();
    expect(result.authorization_endpoint).toContain("/oidc/authorize");
    expect(result.jwks_uri).toContain("/oidc/.well-known/jwks.json");
  });

  it("jwks returns public key set", () => {
    const result = oidc.jwks();
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].kty).toBe("RSA");
    expect(result.keys[0].alg).toBe("RS256");
  });

  it("jwks advertises the signing kid and use", () => {
    const [key] = oidc.jwks().keys;
    expect(key.use).toBe("sig");
    expect(key.kid).toBe(process.env.OIDC_JWKS_KID || "callibrator-oidc-key-1");
    expect(typeof key.n).toBe("string");
    expect(typeof key.e).toBe("string");
  });

  describe("jwks key material", () => {
    // The service builds its key pair at module load, so load isolated instances
    // with a key pair we control in order to assert on the published material.
    const loadWithKey = (modulusLength) => {
      const keys = crypto.generateKeyPairSync("rsa", {
        modulusLength,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      let mod;
      jest.isolateModules(() => {
        const spy = jest
          .spyOn(crypto, "generateKeyPairSync")
          .mockReturnValue(keys);
        mod = require("../../services/oidcProvider.service");
        spy.mockRestore();
      });
      return { mod, keys };
    };

    // REGRESSION: buildJwks used to hand-roll a DER walk that was broken three
    // ways — it ignored der.byteOffset (publishing adjacent heap memory from
    // Node's shared Buffer pool onto this PUBLIC endpoint), mis-decoded
    // long-form lengths, and hex-encoded n/e instead of base64url. It now
    // delegates to Node's SPKI->JWK export.
    it("publishes the real modulus and exponent, base64url-encoded", () => {
      const { mod, keys } = loadWithKey(2048);
      const expected = crypto
        .createPublicKey(keys.publicKey)
        .export({ format: "jwk" });

      const [key] = mod.jwks().keys;

      expect(key.e).toBe(expected.e); // "AQAB"
      expect(key.n).toBe(expected.n);
      expect(key.n).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, never hex
    });

    it("does not leak pool memory for a small key", () => {
      // A 512-bit key's DER is well under 4KB, so it lives at a non-zero
      // byteOffset in the shared pool — the exact condition the old parser
      // mishandled.
      const { mod, keys } = loadWithKey(512);
      const expected = crypto
        .createPublicKey(keys.publicKey)
        .export({ format: "jwk" });

      const [key] = mod.jwks().keys;

      expect(key.n).toBe(expected.n);
    });
  });

  describe("registerClient", () => {
    it("creates client and returns secret", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      const result = await oidc.registerClient("t1", { name: "Test App", redirectUris: ["http://localhost"] });
      expect(result.clientId).toBeDefined();
      expect(result.clientSecret).toBeDefined();
      expect(result.name).toBe("Test App");
    });

    it("stores only a hash of the secret, under the oidc_rp_ namespace", async () => {
      TenantSettings.upsert.mockResolvedValue({});

      const result = await oidc.registerClient("t1", { name: "App", redirectUris: ["http://cb"] });

      const row = TenantSettings.upsert.mock.calls[0][0];
      expect(row.tenantId).toBe("t1");
      expect(row.key).toBe(`oidc_rp_${result.clientId}`);
      // Must not collide with the SSO feature's `oidc_client_secret` setting.
      expect(row.key.startsWith("oidc_client_")).toBe(false);

      const stored = JSON.parse(row.value);
      expect(stored.clientSecretHash).toBe(
        crypto.createHash("sha256").update(result.clientSecret).digest("hex"),
      );
      expect(row.value).not.toContain(result.clientSecret);
    });

    it("defaults scopes, grantTypes and redirectUris when omitted", async () => {
      TenantSettings.upsert.mockResolvedValue({});

      const result = await oidc.registerClient("t1", { name: "App" });

      expect(result.scopes).toEqual(["openid", "profile", "email"]);
      expect(result.grantTypes).toEqual(["authorization_code"]);
      expect(result.redirectUris).toEqual([]);
      const stored = JSON.parse(TenantSettings.upsert.mock.calls[0][0].value);
      expect(stored.redirectUris).toEqual([]);
    });

    it("honours explicitly supplied scopes and grantTypes", async () => {
      TenantSettings.upsert.mockResolvedValue({});

      const result = await oidc.registerClient("t1", {
        name: "App",
        scopes: ["openid"],
        grantTypes: ["refresh_token"],
        redirectUris: ["http://cb"],
      });

      expect(result.scopes).toEqual(["openid"]);
      expect(result.grantTypes).toEqual(["refresh_token"]);
      expect(result.redirectUris).toEqual(["http://cb"]);
    });
  });

  describe("getClients", () => {
    it("lists registered clients", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { value: JSON.stringify({ clientId: "c1", name: "App", redirectUris: [], scopes: [], grantTypes: [] }) },
      ]);
      const result = await oidc.getClients("t1");
      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe("c1");
    });

    it("scans only the oidc_rp_ key namespace for the tenant", async () => {
      TenantSettings.findAll.mockResolvedValue([]);

      await oidc.getClients("t1");

      expect(TenantSettings.findAll).toHaveBeenCalledWith({
        where: { tenantId: "t1", key: { [Op.like]: "oidc_rp_%" } },
      });
    });

    it("skips corrupt, foreign and empty rows instead of throwing", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { value: "this-is-not-json" }, // e.g. an encrypted SSO secret
        { value: "null" }, // parses, but is not an object
        { value: "\"a string\"" }, // parses to a non-object
        {}, // no value at all -> treated as {}
        { value: JSON.stringify({ name: "no client id" }) },
        { value: JSON.stringify({ clientId: "c1", name: "Real", redirectUris: ["u"], scopes: ["openid"], grantTypes: ["authorization_code"], createdAt: "2025-01-01" }) },
      ]);

      const result = await oidc.getClients("t1");

      expect(result).toEqual([
        {
          clientId: "c1",
          name: "Real",
          redirectUris: ["u"],
          scopes: ["openid"],
          grantTypes: ["authorization_code"],
          createdAt: "2025-01-01",
        },
      ]);
    });

    it("never exposes the stored secret hash", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { value: JSON.stringify({ clientId: "c1", name: "App", clientSecretHash: "deadbeef" }) },
      ]);

      const result = await oidc.getClients("t1");

      expect(result[0]).not.toHaveProperty("clientSecretHash");
    });
  });

  describe("rotateSecret", () => {
    it("generates new secret", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify({ clientId: "c1", clientSecretHash: "old" }) });
      TenantSettings.update.mockResolvedValue([1]);
      const result = await oidc.rotateSecret("t1", "c1");
      expect(result.clientSecret).toBeDefined();
      expect(result.clientId).toBe("c1");
    });

    it("persists the new hash and a rotatedAt stamp, preserving other fields", async () => {
      TenantSettings.findOne.mockResolvedValue({
        value: JSON.stringify({ clientId: "c1", name: "App", clientSecretHash: "old" }),
      });
      TenantSettings.update.mockResolvedValue([1]);

      const result = await oidc.rotateSecret("t1", "c1");

      const [values, options] = TenantSettings.update.mock.calls[0];
      const stored = JSON.parse(values.value);
      expect(stored.clientSecretHash).toBe(
        crypto.createHash("sha256").update(result.clientSecret).digest("hex"),
      );
      expect(stored.clientSecretHash).not.toBe("old");
      expect(stored.name).toBe("App");
      expect(stored.rotatedAt).toBeDefined();
      expect(options).toEqual({ where: { tenantId: "t1", key: "oidc_rp_c1" } });
    });

    it("tolerates a row with no value", async () => {
      TenantSettings.findOne.mockResolvedValue({});
      TenantSettings.update.mockResolvedValue([1]);

      const result = await oidc.rotateSecret("t1", "c1");

      expect(result.clientSecret).toHaveLength(64);
      expect(JSON.parse(TenantSettings.update.mock.calls[0][0].value).clientSecretHash).toHaveLength(64);
    });

    it("throws 404 for an unknown client", async () => {
      TenantSettings.findOne.mockResolvedValue(null);

      await expect(oidc.rotateSecret("t1", "nope")).rejects.toMatchObject({
        status: 404,
        message: "OIDC client not found",
      });
    });
  });

  describe("deleteClient", () => {
    it("removes client", async () => {
      TenantSettings.destroy.mockResolvedValue(1);
      const result = await oidc.deleteClient("t1", "c1");
      expect(result.deleted).toBe(true);
      expect(TenantSettings.destroy).toHaveBeenCalledWith({
        where: { tenantId: "t1", key: "oidc_rp_c1" },
      });
    });

    it("reports deleted=false when nothing matched", async () => {
      TenantSettings.destroy.mockResolvedValue(0);
      expect(await oidc.deleteClient("t1", "c1")).toEqual({ deleted: false });
    });
  });

  describe("issueTokens", () => {
    const user = { id: "u1", email: "a@b.com", firstName: "A", lastName: "B" };

    // The service generates its RSA key pair at module load and never exports it.
    // Load an isolated instance with a key pair we control so the signatures it
    // produces can genuinely be verified.
    let isolatedOidc;
    let testKeys;

    beforeAll(() => {
      testKeys = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      jest.isolateModules(() => {
        const spy = jest.spyOn(crypto, "generateKeyPairSync").mockReturnValue(testKeys);
        isolatedOidc = require("../../services/oidcProvider.service");
        spy.mockRestore();
      });
    });

    // REGRESSION: the id_token payload used to set `iat`/`exp` itself while
    // signToken also passed `expiresIn: "15m"`. jsonwebtoken rejects that
    // combination ("Bad "options.expiresIn" option the payload already has an
    // "exp" property"), so issueTokens threw on EVERY call. The payload now
    // leaves expiry to expiresIn.
    it("issues a verifiable RS256 access token and id token", async () => {
      const result = await isolatedOidc.issueTokens("t1", user, ["openid", "profile"]);

      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBe(900);
      expect(result.scope).toBe("openid profile");
      expect(result.refresh_token).toHaveLength(128);

      // The tokens must actually verify against the matching public key.
      const pub = testKeys.publicKey;
      const access = jwt.verify(result.access_token, pub, { algorithms: ["RS256"] });
      expect(access).toMatchObject({
        sub: "u1",
        email: "a@b.com",
        tenant_id: "t1",
        scope: "openid profile",
        typ: "access",
      });

      const id = jwt.verify(result.id_token, pub, { algorithms: ["RS256"] });
      expect(id).toMatchObject({
        sub: "u1",
        given_name: "A",
        family_name: "B",
        aud: "a@b.com",
      });

      expect(jwt.decode(result.access_token, { complete: true }).header).toMatchObject({
        alg: "RS256",
        kid: process.env.OIDC_JWKS_KID || "callibrator-oidc-key-1",
      });
    });

    it("defaults to the openid/profile/email scopes", async () => {
      const result = await isolatedOidc.issueTokens("t1", user);
      expect(result.scope).toBe("openid profile email");
      const claims = jwt.verify(result.access_token, testKeys.publicKey, { algorithms: ["RS256"] });
      expect(claims.scope).toBe("openid profile email");
    });
  });

  describe("verifySecret", () => {
    it("validates client secret", async () => {
      const secret = "test-secret";
      const hash = crypto.createHash("sha256").update(secret).digest("hex");
      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify({ clientSecretHash: hash }) });
      expect(await oidc.verifySecret("t1", "c1", secret)).toBe(true);
      expect(await oidc.verifySecret("t1", "c1", "wrong")).toBe(false);
    });

    it("returns false when the client is unknown", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      expect(await oidc.verifySecret("t1", "c1", "s")).toBe(false);
    });

    it("returns false for a corrupt row or one with no stored hash", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "not-json" });
      expect(await oidc.verifySecret("t1", "c1", "s")).toBe(false);

      TenantSettings.findOne.mockResolvedValue({ value: "null" });
      expect(await oidc.verifySecret("t1", "c1", "s")).toBe(false);

      TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify({ clientId: "c1" }) });
      expect(await oidc.verifySecret("t1", "c1", "s")).toBe(false);
    });

    it("returns false rather than throwing when the stored hash length differs", async () => {
      // timingSafeEqual throws on a length mismatch — the guard must catch this first.
      TenantSettings.findOne.mockResolvedValue({
        value: JSON.stringify({ clientSecretHash: "abcd" }),
      });
      expect(await oidc.verifySecret("t1", "c1", "s")).toBe(false);
    });
  });

  // ======================================================================
  // AUTHORIZATION CODE FLOW
  // ======================================================================
  describe("authorization code flow", () => {
    const USER = {
      id: "user-1",
      email: "a@b.c",
      firstName: "Ada",
      lastName: "Lovelace",
    };
    const CLIENT = {
      clientId: "c1",
      name: "Acme RP",
      redirectUris: ["https://rp.example/cb"],
      scopes: ["openid", "email"],
    };
    const b64url = (buf) =>
      buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const s256 = (v) => b64url(crypto.createHash("sha256").update(v).digest());

    /** Make TenantSettings.findOne resolve a valid client row (optionally with a secret). */
    const mockClientRow = (secret) =>
      TenantSettings.findOne.mockResolvedValue({
        tenantId: "t1",
        value: JSON.stringify({
          ...CLIENT,
          ...(secret
            ? { clientSecretHash: crypto.createHash("sha256").update(secret).digest("hex") }
            : {}),
        }),
      });

    describe("findClientByClientId", () => {
      it("returns null without a clientId", async () => {
        expect(await oidc.findClientByClientId("")).toBeNull();
      });

      it("returns null when no row exists", async () => {
        TenantSettings.findOne.mockResolvedValue(null);
        expect(await oidc.findClientByClientId("nope")).toBeNull();
      });

      it("returns null for a corrupt (non-JSON) row", async () => {
        TenantSettings.findOne.mockResolvedValue({ value: "not-json" });
        expect(await oidc.findClientByClientId("c1")).toBeNull();
      });

      it("returns null for a row without a clientId", async () => {
        TenantSettings.findOne.mockResolvedValue({ value: JSON.stringify({ name: "x" }) });
        expect(await oidc.findClientByClientId("c1")).toBeNull();
      });

      it("returns the client with its owning tenantId", async () => {
        mockClientRow();
        const client = await oidc.findClientByClientId("c1");
        expect(client.clientId).toBe("c1");
        expect(client.tenantId).toBe("t1");
      });
    });

    describe("beginAuthorization", () => {
      const base = {
        client_id: "c1",
        redirect_uri: "https://rp.example/cb",
        response_type: "code",
      };

      it("rejects an unknown client", async () => {
        TenantSettings.findOne.mockResolvedValue(null);
        await expect(oidc.beginAuthorization(base)).rejects.toThrow("Unknown client_id");
      });

      it("rejects a redirect_uri that is not registered", async () => {
        mockClientRow();
        await expect(
          oidc.beginAuthorization({ ...base, redirect_uri: "https://evil/cb" }),
        ).rejects.toThrow("redirect_uri is not registered");
      });

      it("rejects a missing redirect_uri", async () => {
        mockClientRow();
        await expect(
          oidc.beginAuthorization({ ...base, redirect_uri: undefined }),
        ).rejects.toThrow("redirect_uri is not registered");
      });

      it("rejects a response_type other than code", async () => {
        mockClientRow();
        await expect(
          oidc.beginAuthorization({ ...base, response_type: "token" }),
        ).rejects.toThrow("response_type=code");
      });

      it("rejects an unsupported code_challenge_method", async () => {
        mockClientRow();
        await expect(
          oidc.beginAuthorization({
            ...base,
            code_challenge: "abc",
            code_challenge_method: "S1",
          }),
        ).rejects.toThrow("Unsupported code_challenge_method");
      });

      it("stages the request and returns a consent URL (with PKCE + state + nonce)", async () => {
        mockClientRow();
        const result = await oidc.beginAuthorization({
          ...base,
          scope: "openid email",
          state: "st8",
          nonce: "n1",
          code_challenge: "chal",
        });

        expect(result.requestId).toEqual(expect.any(String));
        expect(result.consentUrl).toContain("/oauth/consent?request=");
        const [key, payload] = redis.set.mock.calls[0];
        expect(key).toMatch(/^oidc:authreq:/);
        expect(payload).toMatchObject({
          clientId: "c1",
          tenantId: "t1",
          redirectUri: "https://rp.example/cb",
          scope: ["openid", "email"],
          state: "st8",
          nonce: "n1",
          codeChallenge: "chal",
          codeChallengeMethod: "S256", // defaulted
        });
      });

      it("defaults scope to openid and nulls optional params", async () => {
        mockClientRow();
        await oidc.beginAuthorization(base);
        const [, payload] = redis.set.mock.calls[0];
        expect(payload.scope).toEqual(["openid"]);
        expect(payload.state).toBeNull();
        expect(payload.nonce).toBeNull();
        expect(payload.codeChallenge).toBeNull();
        expect(payload.codeChallengeMethod).toBeNull();
      });
    });

    describe("getAuthRequest", () => {
      it("returns null without a requestId", async () => {
        expect(await oidc.getAuthRequest("")).toBeNull();
      });

      it("returns null when the staged request is gone", async () => {
        redis.get.mockResolvedValue(null);
        expect(await oidc.getAuthRequest("r1")).toBeNull();
      });

      it("returns the display fields for the consent screen", async () => {
        redis.get.mockResolvedValue({
          clientName: "Acme RP",
          scope: ["openid"],
          redirectUri: "https://rp.example/cb",
        });
        expect(await oidc.getAuthRequest("r1")).toEqual({
          clientName: "Acme RP",
          scope: ["openid"],
          redirectUri: "https://rp.example/cb",
        });
      });
    });

    describe("decideAuthorization", () => {
      it("throws when the request expired", async () => {
        redis.get.mockResolvedValue(null);
        await expect(oidc.decideAuthorization("r1", USER, true)).rejects.toThrow(
          "expired or invalid",
        );
      });

      it("returns access_denied (preserving state) when denied", async () => {
        redis.get.mockResolvedValue({
          redirectUri: "https://rp.example/cb",
          state: "st8",
        });
        const { redirectTo } = await oidc.decideAuthorization("r1", USER, false);
        expect(redirectTo).toBe("https://rp.example/cb?state=st8&error=access_denied");
        expect(redis.del).toHaveBeenCalled();
      });

      it("mints a single-use code bound to the user when approved (no state)", async () => {
        redis.get.mockResolvedValue({
          clientId: "c1",
          tenantId: "t1",
          redirectUri: "https://rp.example/cb",
          scope: ["openid"],
          state: null,
          nonce: "n1",
          codeChallenge: "chal",
          codeChallengeMethod: "S256",
        });
        const { redirectTo } = await oidc.decideAuthorization("r1", USER, true);
        expect(redirectTo).toMatch(/^https:\/\/rp\.example\/cb\?code=/);
        const codeCall = redis.set.mock.calls.find(([k]) => k.startsWith("oidc:code:"));
        expect(codeCall[1]).toMatchObject({ clientId: "c1", userId: "user-1", nonce: "n1" });
      });
    });

    describe("exchangeAuthorizationCode", () => {
      const codeData = {
        clientId: "c1",
        tenantId: "t1",
        userId: "user-1",
        redirectUri: "https://rp.example/cb",
        scope: ["openid", "email"],
        nonce: "n1",
      };

      it("rejects a missing/expired code", async () => {
        redis.get.mockResolvedValue(null);
        await expect(
          oidc.exchangeAuthorizationCode({ code: "x", clientId: "c1" }),
        ).rejects.toThrow("invalid_grant");
      });

      it("rejects a redirect_uri mismatch", async () => {
        redis.get.mockResolvedValue(codeData);
        await expect(
          oidc.exchangeAuthorizationCode({
            code: "x",
            clientId: "c1",
            redirectUri: "https://evil/cb",
          }),
        ).rejects.toThrow("redirect_uri mismatch");
      });

      it("rejects when the code was issued to a different client", async () => {
        redis.get.mockResolvedValue(codeData);
        await expect(
          oidc.exchangeAuthorizationCode({
            code: "x",
            clientId: "other",
            redirectUri: codeData.redirectUri,
          }),
        ).rejects.toThrow("invalid_client");
      });

      it("accepts a valid PKCE verifier (S256) and issues tokens with aud+nonce", async () => {
        const verifier = "the-code-verifier-value";
        redis.get.mockResolvedValue({
          ...codeData,
          codeChallenge: s256(verifier),
          codeChallengeMethod: "S256",
        });
        Users.findByPk.mockResolvedValue(USER);

        const tokens = await oidc.exchangeAuthorizationCode({
          code: "x",
          clientId: "c1",
          redirectUri: codeData.redirectUri,
          codeVerifier: verifier,
        });

        expect(tokens.token_type).toBe("Bearer");
        const idClaims = jwt.decode(tokens.id_token);
        expect(idClaims.aud).toBe("c1"); // aud is the client_id, not the email
        expect(idClaims.nonce).toBe("n1");
      });

      it("accepts a plain PKCE verifier", async () => {
        redis.get.mockResolvedValue({
          ...codeData,
          codeChallenge: "plain-value",
          codeChallengeMethod: "plain",
        });
        Users.findByPk.mockResolvedValue(USER);
        const tokens = await oidc.exchangeAuthorizationCode({
          code: "x",
          clientId: "c1",
          redirectUri: codeData.redirectUri,
          codeVerifier: "plain-value",
        });
        expect(tokens.access_token).toEqual(expect.any(String));
      });

      it("rejects a wrong PKCE verifier", async () => {
        redis.get.mockResolvedValue({
          ...codeData,
          codeChallenge: s256("right"),
          codeChallengeMethod: "S256",
        });
        await expect(
          oidc.exchangeAuthorizationCode({
            code: "x",
            clientId: "c1",
            redirectUri: codeData.redirectUri,
            codeVerifier: "wrong",
          }),
        ).rejects.toThrow("invalid_client");
      });

      it("rejects a missing PKCE verifier when a challenge was set", async () => {
        redis.get.mockResolvedValue({
          ...codeData,
          codeChallenge: s256("v"),
          codeChallengeMethod: "S256",
        });
        await expect(
          oidc.exchangeAuthorizationCode({
            code: "x",
            clientId: "c1",
            redirectUri: codeData.redirectUri,
          }),
        ).rejects.toThrow("invalid_client");
      });

      it("falls back to client_secret auth when no PKCE was used", async () => {
        redis.get.mockResolvedValue(codeData); // no codeChallenge
        mockClientRow("s3cret");
        Users.findByPk.mockResolvedValue(USER);

        const tokens = await oidc.exchangeAuthorizationCode({
          code: "x",
          clientId: "c1",
          clientSecret: "s3cret",
          redirectUri: codeData.redirectUri,
        });
        expect(tokens.id_token).toEqual(expect.any(String));
      });

      it("rejects when the user no longer exists", async () => {
        redis.get.mockResolvedValue({ ...codeData, codeChallenge: s256("v"), codeChallengeMethod: "S256" });
        Users.findByPk.mockResolvedValue(null);
        await expect(
          oidc.exchangeAuthorizationCode({
            code: "x",
            clientId: "c1",
            redirectUri: codeData.redirectUri,
            codeVerifier: "v",
          }),
        ).rejects.toThrow("user no longer exists");
      });
    });

    describe("refreshAccessToken", () => {
      const stored = { tenantId: "t1", userId: "user-1", clientId: "c1", scope: "openid email" };

      it("rejects an unknown refresh token", async () => {
        redis.get.mockResolvedValue(null);
        await expect(
          oidc.refreshAccessToken({ refreshToken: "rt", clientId: "c1" }),
        ).rejects.toThrow("invalid_grant");
      });

      it("rejects a client mismatch", async () => {
        redis.get.mockResolvedValue(stored);
        await expect(
          oidc.refreshAccessToken({ refreshToken: "rt", clientId: "other" }),
        ).rejects.toThrow("invalid_client");
      });

      it("rejects a bad client secret", async () => {
        redis.get.mockResolvedValue(stored);
        mockClientRow("right-secret");
        await expect(
          oidc.refreshAccessToken({ refreshToken: "rt", clientId: "c1", clientSecret: "wrong" }),
        ).rejects.toThrow("invalid_client");
      });

      it("rejects when the user no longer exists", async () => {
        redis.get.mockResolvedValue(stored);
        mockClientRow("s3cret");
        Users.findByPk.mockResolvedValue(null);
        await expect(
          oidc.refreshAccessToken({ refreshToken: "rt", clientId: "c1", clientSecret: "s3cret" }),
        ).rejects.toThrow("user no longer exists");
      });

      it("rotates the refresh token and reissues", async () => {
        redis.get.mockResolvedValue(stored);
        mockClientRow("s3cret");
        Users.findByPk.mockResolvedValue(USER);

        const tokens = await oidc.refreshAccessToken({
          refreshToken: "rt",
          clientId: "c1",
          clientSecret: "s3cret",
        });

        expect(redis.del).toHaveBeenCalledWith("oidc:refresh:rt"); // rotated
        expect(tokens.refresh_token).toHaveLength(128);
        expect(jwt.decode(tokens.id_token).aud).toBe("c1");
      });
    });

    describe("getUserInfo", () => {
      const tokenFor = async (scopes) => {
        const t = await oidc.issueTokens("t1", USER, scopes, { clientId: "c1" });
        return t.access_token;
      };

      it("rejects an unverifiable token", async () => {
        await expect(oidc.getUserInfo("not-a-jwt")).rejects.toThrow("invalid_token");
      });

      it("returns only sub when neither email nor profile is scoped", async () => {
        const claims = await oidc.getUserInfo(await tokenFor(["openid"]));
        expect(claims).toEqual({ sub: "user-1" });
      });

      it("includes email for the email scope", async () => {
        const claims = await oidc.getUserInfo(await tokenFor(["openid", "email"]));
        expect(claims.email).toBe("a@b.c");
      });

      it("includes profile claims when the user is found", async () => {
        Users.findByPk.mockResolvedValue(USER);
        const claims = await oidc.getUserInfo(await tokenFor(["openid", "profile"]));
        expect(claims).toMatchObject({
          given_name: "Ada",
          family_name: "Lovelace",
          name: "Ada Lovelace",
        });
      });

      it("omits profile claims when the user row is gone", async () => {
        Users.findByPk.mockResolvedValue(null);
        const claims = await oidc.getUserInfo(await tokenFor(["openid", "profile"]));
        expect(claims.given_name).toBeUndefined();
      });

      it("tolerates a token with an empty scope", async () => {
        const claims = await oidc.getUserInfo(await tokenFor([]));
        expect(claims).toEqual({ sub: "user-1" });
      });

      it("leaves name undefined for a user with no first/last name", async () => {
        Users.findByPk.mockResolvedValue({ id: "user-1", email: "a@b.c" });
        const claims = await oidc.getUserInfo(await tokenFor(["openid", "profile"]));
        expect(claims.name).toBeUndefined();
      });
    });

    // Falsy-argument and fallback paths.
    describe("edge cases", () => {
      it("treats a client with no redirectUris as unregistered", async () => {
        TenantSettings.findOne.mockResolvedValue({
          tenantId: "t1",
          value: JSON.stringify({ clientId: "c1", name: "No URIs" }),
        });
        await expect(
          oidc.beginAuthorization({
            client_id: "c1",
            redirect_uri: "https://rp.example/cb",
            response_type: "code",
          }),
        ).rejects.toThrow("redirect_uri is not registered");
      });

      it("decideAuthorization rejects a missing requestId", async () => {
        await expect(oidc.decideAuthorization("", USER, true)).rejects.toThrow(
          "expired or invalid",
        );
      });

      it("exchange rejects a missing code without hitting redis", async () => {
        await expect(
          oidc.exchangeAuthorizationCode({ clientId: "c1" }),
        ).rejects.toThrow("invalid_grant");
      });

      it("exchange rejects a confidential client that sends no secret", async () => {
        redis.get.mockResolvedValue({
          clientId: "c1",
          tenantId: "t1",
          userId: "user-1",
          redirectUri: "https://rp.example/cb",
          scope: ["openid"],
        }); // no codeChallenge -> secret required
        mockClientRow("s3cret");
        await expect(
          oidc.exchangeAuthorizationCode({
            code: "x",
            clientId: "c1",
            redirectUri: "https://rp.example/cb",
          }),
        ).rejects.toThrow("invalid_client");
      });

      it("refresh rejects a missing refresh token without hitting redis", async () => {
        await expect(
          oidc.refreshAccessToken({ clientId: "c1" }),
        ).rejects.toThrow("invalid_grant");
      });

      it("refresh rejects when no client secret is supplied", async () => {
        redis.get.mockResolvedValue({
          tenantId: "t1",
          userId: "user-1",
          clientId: "c1",
          scope: "openid",
        });
        mockClientRow("s3cret");
        await expect(
          oidc.refreshAccessToken({ refreshToken: "rt", clientId: "c1" }),
        ).rejects.toThrow("invalid_client");
      });
    });
  });
});
