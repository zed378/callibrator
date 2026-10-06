/**
 * U-06 (ADR-119) — the access-key ring hands jsonwebtoken KeyObjects, built
 * once per key material, instead of strings it converts on every verify.
 *
 * Before: `verify(token, "<secret>")` made jsonwebtoken call createPublicKey on
 * the secret (which throws, building an Error and its stack), then
 * createSecretKey, and the ring hashed every key for its id — on every
 * authenticated request. The S-26 contract is unchanged: the ring is still the
 * environment, read on every call, so a rotation applies on the next call.
 *
 * REAL jsonwebtoken and real keys, as jwt.keyring.s26 does.
 */
import { generateKeyPairSync, KeyObject } from "crypto";

import { environment } from "../../config/env";

interface JwtUtil {
  generateAccessToken(payload: Record<string, unknown>): string;
  verifyAccessToken(token: string): Record<string, unknown>;
  getKeyInfo(): { keyId: string | null; previousKeyIds: string[]; keyCount: number };
}
interface JsonWebToken {
  verify: (...args: unknown[]) => unknown;
}

// The live environment object (config/env#environment is process.env itself),
// so the test sets variables the way an operator's environment would.
const penv = environment();

const JWT_KEYS = [
  "JWT_ALGORITHM",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "JWT_PUBLIC_KEY_PREVIOUS",
  "JWT_ACCESS_SECRET_PREVIOUS",
  "JWT_ACCESS_EXPIRED",
];

let saved: NodeJS.ProcessEnv = {};

beforeEach(() => {
  saved = { ...penv };
});

/**
 * Load jwt.util (and the jsonwebtoken it calls) in isolation, as a process booted with `env`.
 * @param env - the JWT_* variables
 * @returns the util, and a spy on the jsonwebtoken `verify` it calls
 */
const load = (env: Record<string, string>): { mod: JwtUtil; verify: jest.SpyInstance } => {
  for (const k of JWT_KEYS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the test resets the JWT_* environment
    delete penv[k];
  }
  Object.assign(penv, { JWT_ACCESS_SECRET: "u06-access-secret", JWT_REFRESH_SECRET: "u06-refresh-secret" }, env);
  let mod: JwtUtil | undefined;
  let verify: jest.SpyInstance | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module registry jwt.util will load from
    const jsonwebtoken = require("jsonwebtoken") as JsonWebToken;
    verify = jest.spyOn(jsonwebtoken, "verify");
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded per "process", in isolation
    mod = require("../../utils/jwt.util") as JwtUtil;
  });
  return { mod: mod as JwtUtil, verify: verify as jest.SpyInstance };
};

afterEach(() => {
  for (const k of Object.keys(penv)) {
    if (!(k in saved)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restoring the environment the test changed
      delete penv[k];
    }
  }
  Object.assign(penv, saved);
});

const keyArgs = (verify: jest.SpyInstance): unknown[] => verify.mock.calls.map((call: unknown[]) => call[1]);

describe("U-06 — verification keys are KeyObjects, built once per key material", () => {
  it("HS256: verify receives a secret KeyObject, the same one on every request (fail-before: a string)", () => {
    const { mod, verify } = load({ JWT_ALGORITHM: "HS256" });
    const token = mod.generateAccessToken({ id: "user-1" });

    for (let i = 0; i < 3; i++) {
      expect(mod.verifyAccessToken(token)).toMatchObject({ id: "user-1", typ: "access" });
    }

    const keys = keyArgs(verify);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBeInstanceOf(KeyObject);
    expect((keys[0] as KeyObject).type).toBe("secret");
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it("a rotation still applies on the next call: a new *_PREVIOUS is in the ring at once (S-26)", () => {
    const { mod } = load({ JWT_ALGORITHM: "HS256" });
    const before = mod.getKeyInfo();
    expect(before.keyCount).toBe(1);

    // The operator's rotation: the old secret moves to *_PREVIOUS, a new one is current.
    const old = load({ JWT_ALGORITHM: "HS256", JWT_ACCESS_SECRET: "u06-old-secret" });
    const oldToken = old.mod.generateAccessToken({ id: "user-2" });
    penv["JWT_ACCESS_SECRET_PREVIOUS"] = "u06-old-secret";

    const after = mod.getKeyInfo();
    expect(after.keyCount).toBe(2);
    expect(after.keyId).toBe(before.keyId);
    expect(mod.verifyAccessToken(oldToken)).toMatchObject({ id: "user-2" });

    // …and leaves it when removed.
    delete penv["JWT_ACCESS_SECRET_PREVIOUS"];
    expect(mod.getKeyInfo().keyCount).toBe(1);
    expect(() => mod.verifyAccessToken(oldToken)).toThrow("Invalid or expired access token");
  });

  it("RS256 with JWT_PUBLIC_KEY: verify receives a public KeyObject", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const { mod, verify } = load({ JWT_ALGORITHM: "RS256", JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });
    const token = mod.generateAccessToken({ id: "user-3" });

    expect(mod.verifyAccessToken(token)).toMatchObject({ id: "user-3" });
    expect(mod.verifyAccessToken(token)).toMatchObject({ id: "user-3" });

    const [first, second] = keyArgs(verify);
    expect(first).toBeInstanceOf(KeyObject);
    expect((first as KeyObject).type).toBe("public");
    expect(second).toBe(first);
  });

  it("RS256 without JWT_PUBLIC_KEY: the public half of JWT_PRIVATE_KEY is used as it was", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const { mod, verify } = load({ JWT_ALGORITHM: "RS256", JWT_PRIVATE_KEY: privateKey });
    const token = mod.generateAccessToken({ id: "user-4" });

    expect(mod.verifyAccessToken(token)).toMatchObject({ id: "user-4" });
    const [key] = keyArgs(verify);
    expect((key as KeyObject).type).toBe("public");
  });
});
