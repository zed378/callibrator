/**
 * P10-10 (ADR-098 §5, Q-46) — passwordless passkey sign-in, end to end over
 * the REAL models and tenant hooks (fixtures/memoryDb), the REAL
 * @simplewebauthn/server verification, auth.service (the shared
 * post-credential path: completePasswordlessSignIn), session.service,
 * audit.service, the sign-in throttle and jwt.util.
 *
 * Nothing about the WebAuthn assertion is mocked: each test signs a real
 * assertion (authenticatorData || sha256(clientDataJSON)) with a real P-256
 * key whose COSE public key is what the user row stores, exactly as an
 * authenticator and verifyRegistration would. Doubled: the database (memoryDb)
 * and the Redis calls of the challenge store (an in-process map).
 */
import { createHash, generateKeyPairSync, sign, type KeyObject } from "crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Service from "../../services/passkeyLogin.service";
import type * as Redis from "../../services/redis.service";
import type * as JwtUtil from "../../utils/jwt.util";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as MfaPolicy from "../../utils/mfaPolicy.util";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); tests set variables on it, read per call. */
const penv = environment();

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof ModelsBarrel>("../../models");
const svc = jest.requireActual<typeof Service>("../../services/passkeyLogin.service");
const redis = jest.requireActual<typeof Redis>("../../services/redis.service");
const jwtUtil = jest.requireActual<typeof JwtUtil>("../../utils/jwt.util");
const rateLimiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
const mfaPolicy = jest.requireActual<typeof MfaPolicy>("../../utils/mfaPolicy.util");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- helpers is a CommonJS subpath; typed by the member used
const { isoCBOR } = require("@simplewebauthn/server/helpers") as {
  isoCBOR: { encode: (value: Map<number, number | Uint8Array>) => Uint8Array };
};

const RP_ID = "localhost";
const ORIGIN = "http://localhost:3000";
const TENANT_A = "a1a1a1a1-0000-4000-8000-000000000a01";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000000b02";
const ROLE_TECH = "7f1a2b3c-0000-4000-8000-0000000000aa";
const ROLE_SUPER = "9be20605-cc6a-4d91-8246-9756b4a1754b";
const USER_A = "11111111-0000-4000-8000-00000000000a";
const USER_B = "22222222-0000-4000-8000-00000000000b";
const CONTEXT = { ip: "203.0.113.7", userAgent: "jest" };

const b64u = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString("base64url");
const sha256 = (data: Buffer | string): Buffer => createHash("sha256").update(data).digest();

/** An authenticator: a P-256 key pair and its credential id. */
interface Authenticator {
  readonly credentialId: string;
  readonly privateKey: KeyObject;
  readonly cosePublicKey: string;
}

const newAuthenticator = (): Authenticator => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(String(jwk.x), "base64url")],
      [-3, Buffer.from(String(jwk.y), "base64url")],
    ]),
  );
  return { credentialId: b64u(sha256(String(Math.random()))), privateKey, cosePublicKey: b64u(cose) };
};

interface AssertionOptions {
  counter?: number;
  rpId?: string;
  userVerified?: boolean;
  userHandle?: string | undefined;
  origin?: string;
  signWith?: KeyObject;
}

/** A real WebAuthn assertion over `challenge`, as `navigator.credentials.get()` serialises it. */
const assert = (auth: Authenticator, challenge: string, userId: string, opts: AssertionOptions = {}) => {
  const flags = 0x01 | (opts.userVerified === false ? 0 : 0x04);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(opts.counter ?? 1);
  const authenticatorData = Buffer.concat([sha256(opts.rpId ?? RP_ID), Buffer.from([flags]), counter]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin: opts.origin ?? ORIGIN, crossOrigin: false }),
  );
  const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), opts.signWith ?? auth.privateKey);
  const handle = "userHandle" in opts ? opts.userHandle : b64u(Buffer.from(userId));
  return {
    id: auth.credentialId,
    rawId: auth.credentialId,
    type: "public-key" as const,
    response: {
      clientDataJSON: b64u(clientDataJSON),
      authenticatorData: b64u(authenticatorData),
      signature: b64u(signature),
      ...(handle === undefined ? {} : { userHandle: handle }),
    },
    clientExtensionResults: {},
  };
};

// ---- the challenge store (Redis), in process --------------------------------
let store: Map<string, unknown>;
beforeEach(() => {
  store = new Map();
  jest.spyOn(redis, "set").mockImplementation(async (key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve(true);
  });
  jest.spyOn(redis, "getDel").mockImplementation(async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return Promise.resolve(value);
  });
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
});

// ---- the world ---------------------------------------------------------------
let authA: Authenticator;
let authB: Authenticator;

// `seed` returns the STORED rows (rows() returns copies): the tests change the world through these.
let rowA: MemoryDbModule.Row;
let pkA: MemoryDbModule.Row;
let tenantRowA: MemoryDbModule.Row | undefined;

const seedUser = (id: string, tenantId: string, auth: Authenticator, extra: MemoryDbModule.Row = {}): MemoryDbModule.Row => {
  const [row] = mdb.seed("User", {
    id,
    email: `${id.slice(0, 8)}@rs-contoh.test`,
    username: `u${id.slice(0, 8)}`,
    password: "$2b$04$unusableunusableunusableunusableunusableunusableunusa",
    firstName: "Pat",
    lastName: "Keys",
    roleId: ROLE_TECH,
    tenantId,
    status: "ACTIVE",
    isActive: true,
    isDeleted: false,
    mustChangePassword: false,
    passwordOneTime: false,
    mfaEnabled: false,
    webauthnEnabled: true,
    ...extra,
  });
  if (!row) {
    throw new Error("seed returned no row");
  }
  // ADR-108 Amendment 1: the passkey is its own row (several per user).
  const [pk] = mdb.seed("WebauthnCredential", {
    userId: id,
    credentialId: auth.credentialId,
    publicKey: auth.cosePublicKey,
    signCount: 0,
    name: "Laptop",
  });
  if (id === USER_A && pk) {
    pkA = pk;
  }
  return row;
};

beforeEach(() => {
  mdb.reset();
  [tenantRowA] = mdb.seed("Tenant", [
    { id: TENANT_A, name: "RS A", code: "RSA", subdomain: "rsa", email: "a@a.test", status: "active" },
    { id: TENANT_B, name: "RS B", code: "RSB", subdomain: "rsb", email: "b@b.test", status: "active" },
  ]);
  mdb.seed("Role", [
    { id: ROLE_TECH, name: "TECHNICIAN", roleLevel: 5 },
    { id: ROLE_SUPER, name: "SUPERADMIN", roleLevel: 10 },
  ]);
  authA = newAuthenticator();
  authB = newAuthenticator();
  rowA = seedUser(USER_A, TENANT_A, authA);
  seedUser(USER_B, TENANT_B, authB);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const start = async (): Promise<{ ceremonyId: string; challenge: string }> => {
  const { ceremonyId, options } = await svc.getPasskeyLoginOptions();
  return { ceremonyId, challenge: options.challenge };
};

const user = (id: string): MemoryDbModule.Row => {
  const row = mdb.rows("User").find((r) => r["id"] === id);
  if (!row) {
    throw new Error(`no user ${id}`);
  }
  return row;
};

const failure = async (promise: Promise<unknown>): Promise<{ status?: number; message?: string }> => {
  try {
    await promise;
  } catch (err) {
    return err as { status?: number; message?: string };
  }
  throw new Error("expected a refusal");
};

// ============================================================================
describe("P10-10 — the options: no identifier in, nothing about any account out", () => {
  it("asks for user verification, offers no allowCredentials, and binds the challenge to a hashed ceremony id", async () => {
    const { ceremonyId, options } = await svc.getPasskeyLoginOptions();
    expect(options.userVerification).toBe("required");
    expect(options.rpId).toBe(RP_ID);
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(ceremonyId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.get(svc.ceremonyKey(ceremonyId))).toBe(options.challenge);
    // The id itself is never a key.
    expect([...store.keys()].some((k) => k.includes(ceremonyId))).toBe(false);
    expect(redis.set).toHaveBeenCalledWith(svc.ceremonyKey(ceremonyId), options.challenge, svc.CEREMONY_TTL_SECONDS);
  });

  it("two calls differ only in the challenge and the ceremony id", async () => {
    const one = await svc.getPasskeyLoginOptions();
    const two = await svc.getPasskeyLoginOptions();
    expect(one.ceremonyId).not.toBe(two.ceremonyId);
    expect({ ...one.options, challenge: "x" }).toEqual({ ...two.options, challenge: "x" });
  });

  it("answers 503 when the challenge cannot be stored (no shared store, no verifiable ceremony)", async () => {
    jest.spyOn(redis, "set").mockResolvedValue(false);
    expect(await failure(svc.getPasskeyLoginOptions())).toMatchObject({ status: 503 });
  });
});

// ============================================================================
describe("P10-10 — a successful passkey sign-in", () => {
  it("opens a session and ONE LOGIN row (method passkey), the token's amr is passkey, the counter advances", async () => {
    const { ceremonyId, challenge } = await start();
    const result = await svc.verifyPasskeyLogin(
      { ceremonyId, credential: assert(authA, challenge, USER_A, { counter: 7 }) },
      CONTEXT,
    );

    expect(result).toMatchObject({ success: true, status: 200, message: "Login successful" });
    const data = result["data"] as Record<string, unknown>;
    expect(data).toMatchObject({ id: USER_A, tenantId: TENANT_A, mfaEnrolmentRequired: false });

    const sessions = mdb.rows("Session");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user_id: USER_A, tenant_id: TENANT_A, auth_method: "passkey" });

    const logins = mdb.rows("AuditLog").filter((r) => r["action"] === "LOGIN");
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({ tenantId: TENANT_A, userId: USER_A, resourceType: "Session" });
    expect(logins[0]?.["changes"]).toEqual({ method: "passkey" });

    const decoded = jwtUtil.verifyAccessToken(String(result["token"])) as unknown as Record<string, unknown>;
    expect(decoded).toMatchObject({ id: USER_A, amr: "passkey", sid: sessions[0]?.["id"] });
    expect(typeof result["refreshToken"]).toBe("string");
    const stored = mdb.rows("WebauthnCredential").find((p) => p["userId"] === USER_A);
    expect(Number(stored?.["signCount"])).toBe(7);
    expect(stored?.["lastUsedAt"]).toBeTruthy();
    expect(user(USER_A)["lastLoginAt"]).toBeTruthy();
  });

  it("Q-46: a platform operator with NO TOTP is admitted — the passkey is the second factor, no enrolment demanded", async () => {
    rowA["roleId"] = ROLE_SUPER;
    const { ceremonyId, challenge } = await start();
    const result = await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT);
    expect(result["data"]).toMatchObject({ mfaEnabled: false, mfaEnrolmentRequired: false });
    // And auth.middleware's rule accepts the session's amr as MFA (a password session would not be).
    const operator = { role: { name: "SUPERADMIN", roleLevel: 10 }, mfaEnabled: false };
    expect(mfaPolicy.mfaEnrolmentRequired(operator, null, { method: "passkey" })).toBe(false);
    expect(mfaPolicy.mfaEnrolmentRequired(operator, null, { method: "password" })).toBe(true);
  });

  it("an account with TOTP enrolled is NOT asked for the code after a passkey (Q-46)", async () => {
    rowA["mfaEnabled"] = true;
    const { ceremonyId, challenge } = await start();
    const result = await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT);
    expect(result["status"]).toBe(200);
    expect(result["token"]).toBeTruthy();
    expect(mdb.rows("Session")).toHaveLength(1);
  });
});

// ============================================================================
describe("P10-10 — every failure before the account is proven is the one 401", () => {
  const expectGeneric401 = (err: { status?: number; message?: string }): void => {
    expect(err).toMatchObject({ status: 401, message: svc.INVALID_CREDENTIALS });
    expect(mdb.rows("Session")).toHaveLength(0);
    expect(mdb.rows("AuditLog").filter((r) => r["action"] === "LOGIN")).toHaveLength(0);
  };

  it("the challenge is single use: the same ceremony cannot be verified twice", async () => {
    const { ceremonyId, challenge } = await start();
    await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT);
    const again = await failure(
      svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { counter: 2 }) }, CONTEXT),
    );
    expect(again).toMatchObject({ status: 401, message: svc.INVALID_CREDENTIALS });
    expect(mdb.rows("Session")).toHaveLength(1);
  });

  it("an unknown or expired ceremony", async () => {
    expectGeneric401(
      await failure(
        svc.verifyPasskeyLogin({ ceremonyId: "x".repeat(43), credential: assert(authA, "Y2hhbGxlbmdl", USER_A) }, CONTEXT),
      ),
    );
  });

  it("an unknown credential", async () => {
    const { ceremonyId, challenge } = await start();
    expectGeneric401(
      await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(newAuthenticator(), challenge, USER_A) }, CONTEXT)),
    );
  });

  it("a credential whose passkey was disabled", async () => {
    // The flag off voids every passkey (a reset or remove-all), even a row left behind.
    rowA["webauthnEnabled"] = false;
    const { ceremonyId, challenge } = await start();
    expectGeneric401(await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT)));
  });

  it("a bad signature (another key) — and it counts against the account's sign-in throttle", async () => {
    const record = jest.spyOn(rateLimiter, "recordLoginFailure");
    const { ceremonyId, challenge } = await start();
    const credential = assert(authA, challenge, USER_A, { signWith: newAuthenticator().privateKey });
    expectGeneric401(await failure(svc.verifyPasskeyLogin({ ceremonyId, credential }, CONTEXT)));
    expect(record).toHaveBeenCalledWith({ identifier: user(USER_A)["email"], ip: CONTEXT.ip });
  });

  it("an assertion WITHOUT user verification is refused (a passkey counts as MFA only with UV)", async () => {
    const { ceremonyId, challenge } = await start();
    expectGeneric401(
      await failure(
        svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { userVerified: false }) }, CONTEXT),
      ),
    );
  });

  it("an assertion for another origin is refused", async () => {
    const { ceremonyId, challenge } = await start();
    expectGeneric401(
      await failure(
        svc.verifyPasskeyLogin(
          { ceremonyId, credential: assert(authA, challenge, USER_A, { origin: "https://evil.example" }) },
          CONTEXT,
        ),
      ),
    );
  });

  it("a user handle that is not the account's, or none, is refused", async () => {
    let { ceremonyId, challenge } = await start();
    expectGeneric401(
      await failure(
        svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { userHandle: b64u(Buffer.from(USER_B)) }) }, CONTEXT),
      ),
    );
    ({ ceremonyId, challenge } = await start());
    expectGeneric401(
      await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { userHandle: undefined }) }, CONTEXT)),
    );
  });

  it("a counter that did not advance (a cloned authenticator?) is refused, audited, and the count left alone", async () => {
    pkA["signCount"] = 9;
    const { ceremonyId, challenge } = await start();
    expectGeneric401(
      await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { counter: 9 }) }, CONTEXT)),
    );
    expect(Number(mdb.rows("WebauthnCredential").find((p) => p["userId"] === USER_A)?.["signCount"])).toBe(9);
    const rows = mdb.rows("AuditLog");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_A,
      actorType: "system",
      actorName: "system:auth-lockout",
      resourceType: "User",
      resourceId: USER_A,
    });
    expect(rows[0]?.["changes"]).toMatchObject({ operation: "PASSKEY_COUNTER_REGRESSION", storedCount: 9, presentedCount: 9 });
  });

  it("a tenant-less account's counter regression is audited under PLATFORM; a zero stored count with a zero presented one is accepted", async () => {
    rowA["tenantId"] = null;
    pkA["signCount"] = 0;
    const { ceremonyId, challenge } = await start();
    // Stored 0 (null), presented 0: an authenticator that keeps no counter — accepted.
    await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { counter: 0 }) }, CONTEXT);
    pkA["signCount"] = 4;
    const next = await start();
    await failure(
      svc.verifyPasskeyLogin({ ceremonyId: next.ceremonyId, credential: assert(authA, next.challenge, USER_A, { counter: 3 }) }, CONTEXT),
    );
    const regression = mdb
      .rows("AuditLog")
      .find((r) => (r["changes"] as { operation?: string } | null)?.operation === "PASSKEY_COUNTER_REGRESSION");
    expect(regression).toMatchObject({ tenantId: "00000000-0000-4000-8000-000000000001" });
  });

  it("a configured RP id other than localhost expects https://<rp id> as the origin", async () => {
    penv["WEBAUTHN_RP_ID"] = "app.example.test";
    try {
      const { ceremonyId, challenge } = await start();
      const result = await svc.verifyPasskeyLogin(
        {
          ceremonyId,
          credential: assert(authA, challenge, USER_A, { rpId: "app.example.test", origin: "https://app.example.test" }),
        },
        CONTEXT,
      );
      expect(result["status"]).toBe(200);
    } finally {
      delete penv["WEBAUTHN_RP_ID"];
    }
  });

  it("a counter of zero on both sides (an authenticator that keeps none) is accepted", async () => {
    const { ceremonyId, challenge } = await start();
    const result = await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A, { counter: 0 }) }, CONTEXT);
    expect(result["status"]).toBe(200);
  });
});

// ============================================================================
describe("P10-10 — the password sign-in's own refusals apply, in its order", () => {
  it("a paused account (A-185 throttle) answers 429 before the assertion is checked", async () => {
    jest.spyOn(rateLimiter, "checkLoginThrottle").mockResolvedValue({ throttled: true, retryAfterSeconds: 60 });
    const { ceremonyId, challenge } = await start();
    const err = await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT));
    expect(err).toMatchObject({ status: 429 });
    expect(mdb.rows("Session")).toHaveLength(0);
  });

  it("a suspended tenant gets the distinct suspended message (403)", async () => {
    if (tenantRowA) {
      tenantRowA["status"] = "suspended";
    }
    const { ceremonyId, challenge } = await start();
    const err = await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT));
    expect(err).toMatchObject({ status: 403, message: "Tenant account is suspended" });
    expect(mdb.rows("Session")).toHaveLength(0);
  });

  it("a locked account answers 423", async () => {
    rowA["lockedUntil"] = new Date(Date.now() + 60000);
    const { ceremonyId, challenge } = await start();
    const err = await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT));
    expect(err).toMatchObject({ status: 423 });
  });

  it("a suspended account answers 403", async () => {
    rowA["status"] = "SUSPENDED";
    const { ceremonyId, challenge } = await start();
    const err = await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT));
    expect(err).toMatchObject({ status: 403, message: "Account is suspended" });
  });
});

// ============================================================================
describe("ADR-108 Am. 1 — several passkeys per user", () => {
  it("a second passkey of the same account signs in too, and only ITS counter advances", async () => {
    const phone = newAuthenticator();
    mdb.seed("WebauthnCredential", {
      userId: USER_A,
      credentialId: phone.credentialId,
      publicKey: phone.cosePublicKey,
      signCount: 0,
      name: "Phone",
    });
    const { ceremonyId, challenge } = await start();
    const result = await svc.verifyPasskeyLogin(
      { ceremonyId, credential: assert(phone, challenge, USER_A, { counter: 3 }) },
      CONTEXT,
    );
    expect(result["data"]).toMatchObject({ id: USER_A });
    const rows = mdb.rows("WebauthnCredential").filter((p) => p["userId"] === USER_A);
    expect(rows.map((p) => [p["name"], Number(p["signCount"])]).sort()).toEqual([
      ["Laptop", 0],
      ["Phone", 3],
    ]);
  });
});

describe("P10-10 — two tenants: a credential signs in as its owner, in its owner's tenant", () => {
  it("tenant A's credential opens a session in tenant A as A's user; tenant B's opens B's — never crossed", async () => {
    let { ceremonyId, challenge } = await start();
    const a = await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authA, challenge, USER_A) }, CONTEXT);
    ({ ceremonyId, challenge } = await start());
    const b = await svc.verifyPasskeyLogin({ ceremonyId, credential: assert(authB, challenge, USER_B) }, CONTEXT);
    expect(a["data"]).toMatchObject({ id: USER_A, tenantId: TENANT_A });
    expect(b["data"]).toMatchObject({ id: USER_B, tenantId: TENANT_B });
    expect(mdb.rows("Session").map((s) => [s["user_id"], s["tenant_id"]]).sort()).toEqual(
      [
        [USER_A, TENANT_A],
        [USER_B, TENANT_B],
      ].sort(),
    );
  });

  it("B's user cannot complete a ceremony with A's credential id (B's handle, B's key)", async () => {
    const { ceremonyId, challenge } = await start();
    const forged = { ...assert(authB, challenge, USER_B), id: authA.credentialId, rawId: authA.credentialId };
    const err = await failure(svc.verifyPasskeyLogin({ ceremonyId, credential: forged }, CONTEXT));
    expect(err).toMatchObject({ status: 401, message: svc.INVALID_CREDENTIALS });
    expect(mdb.rows("Session")).toHaveLength(0);
  });
});
