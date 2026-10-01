/**
 * ADR-108 Amendment 1 — several passkeys per user, through the REAL webauthn
 * router (auth replaced by fixtures/routeClient, everything else real:
 * validate, the TypeScript controller, webauthn.service, auth.service's
 * re-authentication, audit.service) over the REAL models and hooks
 * (fixtures/memoryDb).
 *
 * Two tenants: another user's passkey id — in the other tenant — answers 404,
 * identical to a passkey that does not exist, and nothing is written.
 *
 * Registration is driven with a REAL attestation ("none" format, a real P-256
 * key, authData with the attested credential), verified by the real
 * @simplewebauthn/server.
 *
 * @two-tenant api/webauthn.route.js PATCH /credentials/:id
 * @two-tenant api/webauthn.route.js DELETE /credentials/:id
 */
import { createHash, generateKeyPairSync } from "crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as Redis from "../../services/redis.service";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as BcryptModule from "bcryptjs";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/redis.service");
  return { ...actual, set: jest.fn(), get: jest.fn(), del: jest.fn(), getDel: jest.fn() };
});
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof BcryptModule>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { as, call, twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const redis = jest.requireMock<typeof Redis>("../../services/redis.service");
const rateLimiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
const bcrypt = jest.requireActual<typeof BcryptModule>("bcryptjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the JavaScript router, loaded after the mocks
const router = require("../../routes/api/webauthn.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- helpers is a CommonJS subpath; typed by the member used
const { isoCBOR } = require("@simplewebauthn/server/helpers") as {
  isoCBOR: { encode: (value: unknown) => Uint8Array };
};

const PASSWORD = "Str0ngPassw0rd";
const PK_A = "a1a1a1a1-0000-4000-8000-0000000000a1";
const PK_A2 = "a2a2a2a2-0000-4000-8000-0000000000a2";
const PK_B = "b1b1b1b1-0000-4000-8000-0000000000b1";

let ctx: SuiteContext;
let store: Map<string, unknown>;

const passkey = (id: string, userId: string, credentialId: string, name = "Laptop"): MemoryDbModule.Row => ({
  id,
  userId,
  credentialId,
  publicKey: "cHVibGlj",
  signCount: 0,
  name,
  createdAt: new Date("2026-09-01T00:00:00Z"),
});

beforeEach(async () => {
  mdb.reset();
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
  store = new Map();
  (redis.set as jest.Mock).mockReset().mockImplementation(async (k: string, v: unknown) => {
    store.set(k, v);
    return Promise.resolve(true);
  });
  (redis.get as jest.Mock).mockReset().mockImplementation(async (k: string) => Promise.resolve(store.get(k) ?? null));
  (redis.del as jest.Mock).mockReset().mockImplementation(async (k: string) => Promise.resolve(store.delete(k)));
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "TECHNICIAN"), other: fx.principal(fx.tenantB, "TECHNICIAN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  const hash = await bcrypt.hash(PASSWORD, 4);
  await mdb.sequelize.models["User"]?.update(
    { password: hash, webauthnEnabled: true, mfaEnabled: false },
    { where: {}, skipTenantScope: true },
  );
  mdb.seed("WebauthnCredential", [
    passkey(PK_A, ctx.owner.id, "cred-a-1"),
    passkey(PK_A2, ctx.owner.id, "cred-a-2", "Phone"),
    passkey(PK_B, ctx.other.id, "cred-b-1"),
  ]);
});

twoTenantSuite({
  module: "webauthn",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "PATCH /credentials/:id",
      method: "PATCH",
      path: (id: string) => `/credentials/${id}`,
      id: () => PK_A,
      body: { name: "Work laptop" },
      writes: ["WebauthnCredential", "AuditLog"],
    },
    {
      key: "DELETE /credentials/:id",
      method: "DELETE",
      path: (id: string) => `/credentials/${id}`,
      id: () => PK_A,
      body: { currentPassword: PASSWORD },
      writes: ["WebauthnCredential", "AuditLog"],
    },
  ],
});

const passkeysOf = (userId: string): MemoryDbModule.Row[] =>
  mdb.rows("WebauthnCredential").filter((r) => r["userId"] === userId);
const userRow = (id: string): MemoryDbModule.Row | undefined => mdb.rows("User").find((u) => u["id"] === id);
const audits = (operation: string): MemoryDbModule.Row[] =>
  mdb.rows("AuditLog").filter((a) => (a["changes"] as { operation?: string } | null)?.operation === operation);

describe("ADR-108 Am. 1 — list, rename, revoke my passkeys", () => {
  it("lists only the caller's passkeys, oldest first, never the credential id or key", async () => {
    as(ctx.owner);
    const res = await call(router, "GET", "/credentials");
    expect(res.status).toBe(200);
    const data = (res.body as { data: Record<string, unknown>[] }).data;
    expect(data.map((p) => p["id"]).sort()).toEqual([PK_A, PK_A2].sort());
    expect(JSON.stringify(data)).not.toMatch(/cred-a-|cHVibGlj/);
  });

  it("the proof may carry a code and a recovery code (an account without MFA is checked on its password)", async () => {
    as(ctx.owner);
    const res = await call(router, "DELETE", `/credentials/${PK_A}`, {
      body: { currentPassword: PASSWORD, code: "123456", recoveryCode: "abcd-efgh" },
    });
    expect(res.status).toBe(200);
  });

  it("renames, audited with the old and new name", async () => {
    as(ctx.owner);
    const res = await call(router, "PATCH", `/credentials/${PK_A}`, { body: { name: "  Work laptop  " } });
    expect(res.status).toBe(200);
    expect(passkeysOf(ctx.owner.id).find((p) => p["id"] === PK_A)?.["name"]).toBe("Work laptop");
    expect(audits("WEBAUTHN_RENAME")[0]?.["changes"]).toMatchObject({
      before: { name: "Laptop" },
      after: { name: "Work laptop" },
    });
    expect((await call(router, "PATCH", `/credentials/${PK_A}`, { body: { name: "" } })).status).toBe(400);
  });

  it("revoking one keeps the others and the flag; the audit row names no credential id", async () => {
    as(ctx.owner);
    const res = await call(router, "DELETE", `/credentials/${PK_A}`, { body: { currentPassword: PASSWORD } });
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toEqual({ success: true, remaining: 1 });
    expect(passkeysOf(ctx.owner.id).map((p) => p["id"])).toEqual([PK_A2]);
    expect(userRow(ctx.owner.id)?.["webauthnEnabled"]).toBe(true);
    const row = audits("WEBAUTHN_REVOKE")[0];
    expect(row).toMatchObject({ userId: ctx.owner.id, tenantId: ctx.owner.tenantId });
    expect(row?.["changes"]).toMatchObject({ passkeyId: PK_A, remaining: 1, reauthenticatedWith: "password" });
    expect(JSON.stringify(row)).not.toContain("cred-a-1");
  });

  it("THE LOCK-OUT GUARD: nothing is removed without the password; the last passkey goes only with it, and turns the flag off", async () => {
    as(ctx.owner);
    const without = await call(router, "DELETE", `/credentials/${PK_A}`, { body: {} });
    expect(without.status).toBe(400);
    const wrong = await call(router, "DELETE", `/credentials/${PK_A}`, { body: { currentPassword: "Wr0ngPassword" } });
    expect(wrong.status).toBe(400);
    expect(passkeysOf(ctx.owner.id)).toHaveLength(2);

    await call(router, "DELETE", `/credentials/${PK_A}`, { body: { currentPassword: PASSWORD } });
    const lastWithout = await call(router, "DELETE", `/credentials/${PK_A2}`, { body: {} });
    expect(lastWithout.status).toBe(400);
    expect((lastWithout.body as { message: string }).message).toBe("Removing your last passkey requires your current password");
    expect(passkeysOf(ctx.owner.id)).toHaveLength(1);

    const last = await call(router, "DELETE", `/credentials/${PK_A2}`, { body: { currentPassword: PASSWORD } });
    expect(last.status).toBe(200);
    expect((last.body as { data: unknown }).data).toEqual({ success: true, remaining: 0 });
    expect(passkeysOf(ctx.owner.id)).toHaveLength(0);
    expect(userRow(ctx.owner.id)?.["webauthnEnabled"]).toBe(false);
    // Now there is nothing to list or rename.
    expect((await call(router, "GET", "/credentials")).body).toMatchObject({ data: [] });
    expect((await call(router, "PATCH", `/credentials/${PK_A2}`, { body: { name: "x" } })).status).toBe(404);
  });

  it("turning the account's flag off (remove-all, an admin reset, an erasure) removes every passkey in the same save", async () => {
    const user = await mdb.sequelize.models["User"]?.findOne({ where: { id: ctx.owner.id }, skipTenantScope: true });
    await user?.update({ webauthnEnabled: false });
    expect(passkeysOf(ctx.owner.id)).toHaveLength(0);
    expect(passkeysOf(ctx.other.id)).toHaveLength(1);
  });

  it("remove-all (POST /disable) removes every passkey, audited with the count", async () => {
    as(ctx.owner);
    const res = await call(router, "POST", "/disable", { body: { currentPassword: PASSWORD } });
    expect(res.status).toBe(200);
    expect(passkeysOf(ctx.owner.id)).toHaveLength(0);
    expect(audits("WEBAUTHN_DISABLE")[0]?.["changes"]).toMatchObject({ passkeysRemoved: 2 });
  });
});

// ============================================================================
// Registration with a REAL attestation.
// ============================================================================
const RP_ID = "localhost";
const ORIGIN = "http://localhost:3000";
const b64u = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString("base64url");
const sha256 = (data: Buffer | string): Buffer => createHash("sha256").update(data).digest();

/** A "none" attestation for a fresh P-256 key, over `challenge`. */
const attestation = (challenge: string, credentialId = b64u(sha256(String(Math.random())))) => {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
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
  const credId = Buffer.from(credentialId, "base64url");
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credId.length);
  const authData = Buffer.concat([
    sha256(RP_ID),
    Buffer.from([0x01 | 0x04 | 0x40]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    idLen,
    credId,
    Buffer.from(cose),
  ]);
  const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false }));
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
    clientExtensionResults: {},
  };
};

const register = async (name?: string, credentialId?: string): Promise<RouteClient.RouteResponse> => {
  as(ctx.owner);
  const options = await call(router, "POST", "/registration-options");
  const challenge = (options.body as { data: { challenge: string } }).data.challenge;
  return call(router, "POST", "/verify-registration", {
    body: { ...attestation(challenge, credentialId), ...(name === undefined ? {} : { name }) },
  });
};

describe("ADR-108 Am. 1 — registering another passkey", () => {
  it("adds a third passkey beside the two, named, audited WEBAUTHN_REGISTER; the options exclude the enrolled ones", async () => {
    as(ctx.owner);
    const options = await call(router, "POST", "/registration-options");
    const excluded = (options.body as { data: { excludeCredentials: { id: string }[] } }).data.excludeCredentials.map((c) => c.id);
    expect(excluded.sort()).toEqual(["cred-a-1", "cred-a-2"]);

    const res = await register("YubiKey");
    expect(res.status).toBe(200);
    const created = (res.body as { data: { credential: { name: string; id: string } } }).data.credential;
    expect(created.name).toBe("YubiKey");
    expect(passkeysOf(ctx.owner.id)).toHaveLength(3);
    const row = audits("WEBAUTHN_REGISTER")[0];
    expect(row?.["changes"]).toMatchObject({ passkeyId: created.id, name: "YubiKey", passkeysHeld: 3 });
    expect(JSON.stringify(row)).not.toMatch(/"credentialId"|publicKey/);
  });

  it("an unnamed passkey is named by its position; an already-registered credential is 409", async () => {
    const res = await register(undefined);
    expect((res.body as { data: { credential: { name: string } } }).data.credential.name).toBe("Passkey 3");
    const dup = await register("again", "cred-b-1");
    expect(dup.status).toBe(409);
  });

  it("after a reset (flag off), a new registration starts clean — no old passkey comes back", async () => {
    // A leftover row (as a bulk write could leave) with the flag off.
    await mdb.sequelize.models["User"]?.update({ webauthnEnabled: false }, { where: { id: ctx.owner.id }, skipTenantScope: true });
    expect(passkeysOf(ctx.owner.id)).toHaveLength(2);
    const res = await register("New phone");
    expect(res.status).toBe(200);
    expect(passkeysOf(ctx.owner.id).map((p) => p["name"])).toEqual(["New phone"]);
    expect(userRow(ctx.owner.id)?.["webauthnEnabled"]).toBe(true);
  });

  it("refuses an 11th passkey (the limit is 10)", async () => {
    mdb.seed(
      "WebauthnCredential",
      Array.from({ length: 8 }, (_, i) =>
        passkey(`c${String(i)}c${String(i)}c${String(i)}c${String(i)}-0000-4000-8000-00000000000${String(i)}`, ctx.owner.id, `extra-${String(i)}`),
      ),
    );
    as(ctx.owner);
    const options = await call(router, "POST", "/registration-options");
    expect(options.status).toBe(409);
  });

  it("GET /status reports the count", async () => {
    as(ctx.owner);
    const res = await call(router, "GET", "/status");
    expect((res.body as { data: Record<string, unknown> }).data).toMatchObject({ enabled: true, count: 2 });
  });
});
