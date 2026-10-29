/**
 * OIDC id_token verification with REAL keys and the REAL jsonwebtoken.
 *
 * The JWK -> PEM conversion (Node's crypto, since jwk-to-pem was removed for
 * its elliptic advisory) actually yields a key jsonwebtoken verifies with --
 * the contract a mock cannot show.
 */
import type * as JwtModule from "jsonwebtoken";
import type * as NodeCrypto from "crypto";
import type * as OidcJwksModule from "../../services/oidcJwks";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const nodeCrypto = require("crypto") as typeof NodeCrypto;
const jwt = require("jsonwebtoken") as typeof JwtModule;
const axios = require("axios") as { get: jest.Mock };
const oidcJwks = require("../../services/oidcJwks") as typeof OidcJwksModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const ISSUER = "https://issuer.example.com";
const CLIENT = "client-1";

interface KeyPair { publicKey: NodeCrypto.KeyObject; privateKey: NodeCrypto.KeyObject }

const keyPair = (type: string, opts: Record<string, unknown>): KeyPair => {
  if (type === "rsa") {
    return nodeCrypto.generateKeyPairSync("rsa", {
      modulusLength: opts["modulusLength"] as number,
    });
  }
  return nodeCrypto.generateKeyPairSync("ec", {
    namedCurve: opts["namedCurve"] as "prime256v1",
  });
};
const publicJwk = (kp: KeyPair, kid: string, alg: string): Record<string, unknown> => ({
  ...(kp.publicKey.export({ format: "jwk" }) as unknown as Record<string, unknown>),
  kid,
  alg,
});
const sign = (kp: KeyPair, alg: string, kid: string, claims: Record<string, unknown> = {}): string =>
  jwt.sign({ sub: "user-1", ...claims }, kp.privateKey, {
    algorithm: alg as JwtModule.Algorithm,
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
    ["ES256", "ec", { namedCurve: "prime256v1" }],
  ])("verifies a real %s id_token against its JWKS", async (alg, type, opts) => {
    const kp = keyPair(type, opts);
    axios.get.mockResolvedValueOnce({ data: { keys: [publicJwk(kp, "k1", alg)] } });

    const decoded = (await oidcJwks.verifyIdToken(sign(kp, alg, "k1"), ISSUER, CLIENT)) as Record<
            string,
            unknown
        >;

    expect(decoded["sub"]).toBe("user-1");
  });

  it("refuses a token signed by a different key with the same kid", async () => {
    const published = keyPair("rsa", { modulusLength: 2048 });
    const attacker = keyPair("rsa", { modulusLength: 2048 });
    axios.get.mockResolvedValueOnce({
      data: { keys: [publicJwk(published, "k1", "RS256")] },
    });

    await expect(oidcJwks.verifyIdToken(sign(attacker, "RS256", "k1"), ISSUER, CLIENT)).rejects.toMatchObject({
      status: 401,
    });
  });
});
