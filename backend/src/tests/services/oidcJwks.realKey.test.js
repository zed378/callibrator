/**
 * OIDC id_token verification with REAL keys and the REAL jsonwebtoken.
 *
 * The unit suite mocks jsonwebtoken; this one proves the JWK -> PEM conversion
 * (Node's crypto, since jwk-to-pem was removed for its elliptic advisory)
 * actually yields a key jsonwebtoken verifies with — the contract a mock
 * cannot show.
 */

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const oidcJwks = require("../../services/oidcJwks");

const ISSUER = "https://issuer.example.com";
const CLIENT = "client-1";

const keyPair = (type, opts) => crypto.generateKeyPairSync(type, opts);
const publicJwk = (kp, kid, alg) => ({
  ...kp.publicKey.export({ format: "jwk" }),
  kid,
  alg,
});
const sign = (kp, alg, kid, claims = {}) =>
  jwt.sign({ sub: "user-1", ...claims }, kp.privateKey, {
    algorithm: alg,
    keyid: kid,
    issuer: ISSUER,
    audience: CLIENT,
  });

describe("oidcJwks with real keys", () => {
  beforeEach(() => {
    axios.get.mockReset();
    oidcJwks.clearCache();
  });

  it.each([
    ["RS256", "rsa", { modulusLength: 2048 }],
    ["ES256", "ec", { namedCurve: "P-256" }],
  ])("verifies a real %s id_token against its JWKS", async (alg, type, opts) => {
    const kp = keyPair(type, opts);
    axios.get.mockResolvedValueOnce({ data: { keys: [publicJwk(kp, "k1", alg)] } });

    const decoded = await oidcJwks.verifyIdToken(sign(kp, alg, "k1"), ISSUER, CLIENT);

    expect(decoded.sub).toBe("user-1");
  });

  it("refuses a token signed by a different key with the same kid", async () => {
    const published = keyPair("rsa", { modulusLength: 2048 });
    const attacker = keyPair("rsa", { modulusLength: 2048 });
    axios.get.mockResolvedValueOnce({
      data: { keys: [publicJwk(published, "k1", "RS256")] },
    });

    await expect(
      oidcJwks.verifyIdToken(sign(attacker, "RS256", "k1"), ISSUER, CLIENT),
    ).rejects.toMatchObject({ status: 401 });
  });
});
