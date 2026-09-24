/**
 * S-26 — the JWT access-key "registry" was decorative, and a deployment that
 * pinned any algorithm but HS256 stopped verifying every token after 30 days
 * of uptime (the registry's one key expired; the fallback was HS256-only).
 *
 * REAL jsonwebtoken and real RSA / EC keys: this is a cryptographic contract.
 * Each case loads jwt.util in isolation with the environment it describes,
 * exactly as a process booted with it.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const DAY = 24 * 60 * 60 * 1000;
const BASE_ENV = {
  JWT_ACCESS_SECRET: "s26-access-secret-current",
  JWT_REFRESH_SECRET: "s26-refresh-secret",
};

const load = (env) => {
  const saved = { ...process.env };
  for (const k of [
    "JWT_ALGORITHM",
    "JWT_PRIVATE_KEY",
    "JWT_PUBLIC_KEY",
    "JWT_PUBLIC_KEY_PREVIOUS",
    "JWT_ACCESS_SECRET_PREVIOUS",
    "JWT_ACCESS_EXPIRED",
    "JWT_KEY_ID",
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, BASE_ENV, env);
  let mod;
  jest.isolateModules(() => {
    mod = require("../../utils/jwt.util");
  });
  // The util reads JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / *_PREVIOUS when used,
  // so the environment stays until the test ends.
  return { mod, restore: () => (process.env = saved) };
};

const rsa = () =>
  crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

let restore = () => {};
afterEach(() => {
  restore();
  jest.useRealTimers();
});

describe("S-26 — the active key set cannot expire", () => {
  it.each(["HS256", "HS512"])(
    "%s: a valid token still verifies after 31 days of uptime (the S-26 DoD test)",
    (alg) => {
      jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
      const loaded = load({ JWT_ALGORITHM: alg, JWT_ACCESS_EXPIRED: "90d" });
      restore = loaded.restore;
      const booted = loaded.mod; // "process start" is now

      jest.setSystemTime(new Date(Date.now() + 31 * DAY));
      const token = booted.generateAccessToken({ id: "user-1" });
      expect(booted.verifyAccessToken(token)).toMatchObject({ id: "user-1", typ: "access" });
    },
  );

  it("RS256: after 31 days of uptime a token still verifies", () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    const { publicKey, privateKey } = rsa();
    const loaded = load({ JWT_ALGORITHM: "RS256", JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });
    restore = loaded.restore;
    jest.setSystemTime(new Date(Date.now() + 31 * DAY));
    const token = loaded.mod.generateAccessToken({ id: "user-1" });
    expect(loaded.mod.verifyAccessToken(token)).toMatchObject({ id: "user-1" });
  });
});

describe("S-26 — rotation by environment, selected by kid", () => {
  it("HS: a token names its key by fingerprint; with the old secret as PREVIOUS both verify; without it the old token fails", () => {
    const before = load({ JWT_ALGORITHM: "HS512", JWT_ACCESS_SECRET: "old-secret" });
    const oldToken = before.mod.generateAccessToken({ id: "u" });
    before.restore();

    const rotated = load({ JWT_ALGORITHM: "HS512", JWT_ACCESS_SECRET: "new-secret", JWT_ACCESS_SECRET_PREVIOUS: "old-secret" });
    restore = rotated.restore;
    const newToken = rotated.mod.generateAccessToken({ id: "u" });
    const kidOld = jwt.decode(oldToken, { complete: true }).header.kid;
    const kidNew = jwt.decode(newToken, { complete: true }).header.kid;
    expect(kidOld).toMatch(/^[0-9a-f]{16}$/);
    expect(kidNew).not.toBe(kidOld);
    expect(rotated.mod.getActiveKeyIds()).toEqual([kidNew, kidOld]);
    expect(rotated.mod.getKeyInfo()).toEqual({ keyId: kidNew, algorithm: "HS512", previousKeyIds: [kidOld], keyCount: 2 });
    expect(rotated.mod.verifyAccessToken(oldToken)).toMatchObject({ id: "u" });
    expect(rotated.mod.verifyAccessToken(newToken)).toMatchObject({ id: "u" });
    rotated.restore();

    const done = load({ JWT_ALGORITHM: "HS512", JWT_ACCESS_SECRET: "new-secret" });
    restore = done.restore;
    expect(() => done.mod.verifyAccessToken(oldToken)).toThrow("Invalid or expired access token");
    expect(done.mod.verifyAccessToken(newToken)).toMatchObject({ id: "u" });
  });

  it("RS: the previous PUBLIC key keeps tokens signed by the previous private key valid", () => {
    const oldPair = rsa();
    const newPair = rsa();
    const before = load({ JWT_ALGORITHM: "RS256", JWT_PRIVATE_KEY: oldPair.privateKey, JWT_PUBLIC_KEY: oldPair.publicKey });
    const oldToken = before.mod.generateAccessToken({ id: "u" });
    before.restore();

    const rotated = load({
      JWT_ALGORITHM: "RS256",
      JWT_PRIVATE_KEY: newPair.privateKey,
      JWT_PUBLIC_KEY: newPair.publicKey,
      JWT_PUBLIC_KEY_PREVIOUS: oldPair.publicKey,
    });
    restore = rotated.restore;
    expect(rotated.mod.verifyAccessToken(oldToken)).toMatchObject({ id: "u" });
    expect(rotated.mod.verifyAccessToken(rotated.mod.generateAccessToken({ id: "v" }))).toMatchObject({ id: "v" });
    expect(rotated.mod.getKeyInfo().keyCount).toBe(2);
  });

  it("RS with no JWT_PUBLIC_KEY verifies with the public half of JWT_PRIVATE_KEY, under the same kid", () => {
    const { privateKey, publicKey } = rsa();
    const loaded = load({ JWT_ALGORITHM: "RS256", JWT_PRIVATE_KEY: privateKey });
    restore = loaded.restore;
    const token = loaded.mod.generateAccessToken({ id: "u" });
    expect(loaded.mod.verifyAccessToken(token)).toMatchObject({ id: "u" });
    // The kid is the fingerprint of the public key however it is supplied.
    process.env.JWT_PUBLIC_KEY = publicKey;
    expect(loaded.mod.getActiveKeyIds()).toEqual([jwt.decode(token, { complete: true }).header.kid]);
  });

  it("ES256 signs and verifies", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const loaded = load({ JWT_ALGORITHM: "ES256", JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });
    restore = loaded.restore;
    expect(loaded.mod.verifyAccessToken(loaded.mod.generateAccessToken({ id: "u" }))).toMatchObject({ id: "u" });
  });

  it("an asymmetric deployment with no JWT_PRIVATE_KEY refuses to sign, naming it", () => {
    const loaded = load({ JWT_ALGORITHM: "RS256" });
    restore = loaded.restore;
    expect(() => loaded.mod.generateAccessToken({ id: "u" })).toThrow(
      "Algorithm RS256 requires JWT_PRIVATE_KEY environment variable",
    );
    expect(loaded.mod.getKeyInfo()).toEqual({ keyId: null, algorithm: "RS256", previousKeyIds: [], keyCount: 0 });
    expect(() => loaded.mod.verifyAccessToken("a.b.c")).toThrow("Invalid or expired access token");
  });

  it("NO HS256 FALLBACK: an RS256 deployment refuses an HS256 token made with JWT_ACCESS_SECRET", () => {
    const { privateKey, publicKey } = rsa();
    const loaded = load({ JWT_ALGORITHM: "RS256", JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });
    restore = loaded.restore;
    const forged = jwt.sign({ id: "admin", typ: "access" }, BASE_ENV.JWT_ACCESS_SECRET, { algorithm: "HS256" });
    expect(() => loaded.mod.verifyAccessToken(forged)).toThrow("Invalid or expired access token");
  });

  it("the algorithm is pinned: an HS512 deployment refuses an HS256 token under the same secret", () => {
    const loaded = load({ JWT_ALGORITHM: "HS512" });
    restore = loaded.restore;
    const hs256 = jwt.sign({ id: "u", typ: "access" }, BASE_ENV.JWT_ACCESS_SECRET, { algorithm: "HS256" });
    expect(() => loaded.mod.verifyAccessToken(hs256)).toThrow("Invalid or expired access token");
  });

  it("a token with no kid, or a kid the ring does not know (pre-S-26 'default'), is tried against each key", () => {
    const loaded = load({ JWT_ALGORITHM: "HS256", JWT_ACCESS_SECRET_PREVIOUS: "older" });
    restore = loaded.restore;
    const noKid = jwt.sign({ id: "u", typ: "access" }, "older", { algorithm: "HS256" });
    const legacyKid = jwt.sign({ id: "u", typ: "access" }, BASE_ENV.JWT_ACCESS_SECRET, { algorithm: "HS256", keyid: "default" });
    expect(loaded.mod.verifyAccessToken(noKid)).toMatchObject({ id: "u" });
    expect(loaded.mod.verifyAccessToken(legacyKid)).toMatchObject({ id: "u" });
  });

  it("a token whose kid names the CURRENT key is not also tried against the previous one", () => {
    const loaded = load({ JWT_ALGORITHM: "HS256", JWT_ACCESS_SECRET_PREVIOUS: "older" });
    restore = loaded.restore;
    const currentKid = loaded.mod.getActiveKeyIds()[0];
    // Signed with the PREVIOUS secret but claiming the current key's id.
    const lying = jwt.sign({ id: "u", typ: "access" }, "older", { algorithm: "HS256", keyid: currentKid });
    expect(() => loaded.mod.verifyAccessToken(lying)).toThrow("Invalid or expired access token");
  });

  it("an expired token is reported as EXPIRED, not as invalid", () => {
    const loaded = load({ JWT_ALGORITHM: "HS256" });
    restore = loaded.restore;
    const expired = loaded.mod.generateAccessToken({ id: "u" }, { expiresIn: -10 });
    let caught;
    try {
      loaded.mod.verifyAccessToken(expired);
    } catch (err) {
      caught = err;
    }
    // (isolateModules loads its own jsonwebtoken, so compare by name, not class)
    expect(caught && caught.name).toBe("TokenExpiredError");
  });

  it("a verified token of the wrong type is refused with the caller's message", () => {
    const loaded = load({ JWT_ALGORITHM: "HS256" });
    restore = loaded.restore;
    expect(() => loaded.mod.verifyPurposeToken(loaded.mod.generateAccessToken({ id: "u" }), "mfa")).toThrow(
      "Invalid or expired mfa token",
    );
  });

  it("the decorative registry is gone: no rotateKeys, no keyRegistry", () => {
    const loaded = load({});
    restore = loaded.restore;
    expect(loaded.mod.rotateKeys).toBeUndefined();
    expect(loaded.mod.keyRegistry).toBeUndefined();
  });
});
