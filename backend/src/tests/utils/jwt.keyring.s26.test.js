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
