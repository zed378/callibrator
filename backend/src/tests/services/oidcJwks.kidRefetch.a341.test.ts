/**
 * A-341 — an OIDC identity provider that rotates its signing key no longer
 * breaks that tenant's SSO for up to six hours.
 *
 * `fetchJwks` caches the JWKS by URL for 6 h, and an id_token whose `kid` was
 * not in the cached set was refused (401) with no refetch. Decision (main
 * session, 2026-10-01): on an unknown `kid`, refetch ONCE — through the same
 * SSRF-pinned transport — then verify or refuse. The refetch is bounded: at
 * most one per JWKS URL per window (60 s), and concurrent callers share the
 * one in-flight fetch, so a stream of bogus kids cannot become a fetch flood.
 *
 * Real keys and the real jsonwebtoken; axios is doubled (the IdP).
 * Fail-before: the rotated-key test was refused with "No matching public key
 * found", and no second fetch was made.
 */
import { generateKeyPairSync } from "crypto";
import type { KeyObject } from "crypto";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS modules, loaded after their doubles */
const jwt = require("jsonwebtoken") as { sign: (p: object, k: KeyObject, o: object) => string };
const axios = require("axios") as { get: jest.Mock };
const oidcJwks = require("../../services/oidcJwks") as {
  verifyIdToken: (t: string, iss: string, aud: string) => Promise<{ sub: string }>;
  clearCache: () => void;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ISSUER = "https://issuer.example.com";
const CLIENT = "client-a341";

const rsa = (): { publicKey: KeyObject; privateKey: KeyObject } => generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (kp: { publicKey: KeyObject }, kid: string): object => ({
  ...(kp.publicKey.export({ format: "jwk" }) as object),
  kid,
  alg: "RS256",
});
const sign = (kp: { privateKey: KeyObject }, kid: string): string =>
  jwt.sign({ sub: "user-a341" }, kp.privateKey, { algorithm: "RS256", keyid: kid, issuer: ISSUER, audience: CLIENT });

beforeEach(() => {
  axios.get.mockReset();
  oidcJwks.clearCache();
  jest.useRealTimers();
});

describe("A-341 — an unknown kid refetches the JWKS once, bounded", () => {
  it("a rotated key is accepted at once, without waiting for the 6 h cache", async () => {
    const before = rsa();
    const after = rsa();
    axios.get
      .mockResolvedValueOnce({ data: { keys: [jwkOf(before, "k-old")] } })
      .mockResolvedValueOnce({ data: { keys: [jwkOf(before, "k-old"), jwkOf(after, "k-new")] } });

    await expect(oidcJwks.verifyIdToken(sign(before, "k-old"), ISSUER, CLIENT)).resolves.toMatchObject({ sub: "user-a341" });
    // The IdP rotates: the next token carries a kid the cache does not hold.
    await expect(oidcJwks.verifyIdToken(sign(after, "k-new"), ISSUER, CLIENT)).resolves.toMatchObject({ sub: "user-a341" });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("a kid the IdP does not publish even after the refetch is still refused (401)", async () => {
    const kp = rsa();
    axios.get.mockResolvedValue({ data: { keys: [jwkOf(kp, "k1")] } });
    await expect(oidcJwks.verifyIdToken(sign(kp, "k1"), ISSUER, CLIENT)).resolves.toBeTruthy();
    await expect(oidcJwks.verifyIdToken(sign(kp, "bogus"), ISSUER, CLIENT)).rejects.toMatchObject({ status: 401 });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("a flood of bogus kids triggers at most ONE fetch per window, sequential or concurrent", async () => {
    const kp = rsa();
    axios.get.mockResolvedValue({ data: { keys: [jwkOf(kp, "k1")] } });
    await oidcJwks.verifyIdToken(sign(kp, "k1"), ISSUER, CLIENT); // fills the cache: fetch 1
    const bogus = Array.from({ length: 25 }, (_, i) => sign(kp, `bogus-${String(i)}`));
    // concurrent
    const concurrent = await Promise.allSettled(bogus.slice(0, 15).map((t) => oidcJwks.verifyIdToken(t, ISSUER, CLIENT)));
    // sequential
    for (const t of bogus.slice(15)) {
      await expect(oidcJwks.verifyIdToken(t, ISSUER, CLIENT)).rejects.toMatchObject({ status: 401 });
    }
    expect(concurrent.every((r) => r.status === "rejected")).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2); // the fill, and ONE refetch for all 25
  });

  it("after the window a new unknown kid may refetch again", async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    try {
      const kp = rsa();
      const rotated = rsa();
      axios.get.mockResolvedValue({ data: { keys: [jwkOf(kp, "k1")] } });
      await oidcJwks.verifyIdToken(sign(kp, "k1"), ISSUER, CLIENT); // fetch 1
      await expect(oidcJwks.verifyIdToken(sign(kp, "x1"), ISSUER, CLIENT)).rejects.toMatchObject({ status: 401 }); // fetch 2
      await expect(oidcJwks.verifyIdToken(sign(kp, "x2"), ISSUER, CLIENT)).rejects.toMatchObject({ status: 401 }); // no fetch
      expect(axios.get).toHaveBeenCalledTimes(2);
      clock.mockReturnValue(now + 61_000);
      axios.get.mockResolvedValue({ data: { keys: [jwkOf(kp, "k1"), jwkOf(rotated, "k2")] } });
      await expect(oidcJwks.verifyIdToken(sign(rotated, "k2"), ISSUER, CLIENT)).resolves.toBeTruthy(); // fetch 3
      expect(axios.get).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("A-341 — a failed refetch does not change the answer", () => {
  it("the IdP unreachable during the refetch: the unknown kid is the same 401, not a 500", async () => {
    const kp = rsa();
    axios.get.mockResolvedValueOnce({ data: { keys: [jwkOf(kp, "k1")] } }).mockRejectedValueOnce(new Error("ECONNRESET"));
    await oidcJwks.verifyIdToken(sign(kp, "k1"), ISSUER, CLIENT);
    await expect(oidcJwks.verifyIdToken(sign(kp, "rotated"), ISSUER, CLIENT)).rejects.toMatchObject({
      status: 401,
      message: "No matching public key found for JWT with kid: rotated",
    });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
