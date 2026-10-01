/**
 * A-293 (ADR-100) — certificate enumeration through the public verification
 * endpoint.
 *
 * Certificate numbers are sequential (CERT-YYYYMMDD-<code>-NNNN), and GET
 * /certificates/verify/:number answered anyone who walked them with the
 * device name and serial number, the names of who calibrated, approved and
 * signed, and the whole document. Now:
 *
 *  - with `?token=` equal to the certificate's verification token (what its QR
 *    code carries) → the FULL verdict, `disclosure: "full"`;
 *  - with no token, or a wrong one (any length, or repeated) → the MINIMAL
 *    verdict, byte-identical between the two, `disclosure: "minimal"`: status,
 *    issuer, dates and the integrity hashes; no device, serial, signer,
 *    document, documentUrl or verifyUrl;
 *  - an already-printed, token-less QR URL still answers (minimal), with no
 *    redirect;
 *  - per-address request budgets: a verdict that is not the full one counts
 *    against `certificateVerify` (60 / 15 min); every request counts against
 *    `certificateVerifyToken` (300 / 15 min), as does the stored-document
 *    capability route. 429 carries Retry-After.
 *
 * REAL router, controller, certificatePdf + certificateDocument services,
 * Certificate model and tenant hooks (fixtures/memoryDb), requestBudget and
 * the rate limiter's in-memory store. Doubled: Redis (absent, so the store
 * counts in memory — its documented outage path) and the disk check for the
 * stored pre-M-11 PDF.
 */
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/certificates.route";
import { environment } from "../../config/env";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  ...jest.requireActual<Record<string, unknown>>("../../services/redis.service"),
  getRedisConnection: () => null,
}));

interface Limiter {
  clearMemoryStore(): void;
}

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/certificates.route");
const limiter = jest.requireActual<Limiter>("../../services/rateLimiter.redis.service");

const DEVICE = "c1000000-0000-4000-8000-000000000001";
const SIGNED = "c2000000-0000-4000-8000-000000000001";
const WITHDRAWN = "c2000000-0000-4000-8000-000000000002";
const NUMBER = "CERT-20260929-A293-0001";
const WITHDRAWN_NUMBER = "CERT-20260929-A293-0002";
const TOKEN = "Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";
const OTHER_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const STORED_PDF = "1758600000000-4242-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf";
const SERIAL = "SN-A293-SECRET";
const DEVICE_NAME = "Defibrillator A293";

const MINIMAL_KEYS = [
  "certificateNumber",
  "disclosure",
  "expired",
  "found",
  "integrity",
  "issueDate",
  "issuedTo",
  "revoked",
  "status",
  "type",
  "valid",
  "validUntil",
  "withdrawn",
];

interface VerifyReply {
  success: boolean;
  status: number;
  data: Record<string, unknown> | null;
  retryAfter?: number;
}

const processEnv = environment();
const ENV_KEYS = ["RATE_LIMIT_NON_PRODUCTION_FACTOR", "PUBLIC_BASE_URL", "CERT_VERIFY_BASE_URL"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, processEnv[k]]));
let signerFirstName = "";

beforeAll(() => {
  processEnv["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
  processEnv["PUBLIC_BASE_URL"] = "https://callibrator.test";
  delete processEnv["CERT_VERIFY_BASE_URL"];
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      Reflect.deleteProperty(processEnv, k);
    } else {
      processEnv[k] = savedEnv[k];
    }
  }
});

beforeEach(() => {
  mdb.reset();
  limiter.clearMemoryStore();
  const realExists = fs.existsSync;
  jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith(STORED_PDF) || realExists(p));
  const fx = twoTenants();
  const signer = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [signer]);
  signerFirstName = `Signer${signer.id.slice(0, 6)}`;
  mdb.seed("User", {
    id: "c3000000-0000-4000-8000-000000000001",
    tenantId: fx.tenantA.id,
    username: "calibrator-a293",
    firstName: signerFirstName,
    lastName: "Tech",
    email: "calibrator-a293@a.test",
    password: "not-a-hash",
    roleId: signer.role.id,
    status: "ACTIVE",
    isActive: true,
  });
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: fx.tenantA.id, name: DEVICE_NAME, serialNumber: SERIAL });
  const common = {
    tenantId: fx.tenantA.id,
    deviceId: DEVICE,
    type: "calibration",
    status: "signed",
    standard: "ISO 17025",
    summary: "Within tolerance",
    calibratedBy: "c3000000-0000-4000-8000-000000000001",
    approvedBy: "c3000000-0000-4000-8000-000000000001",
    signedBy: "c3000000-0000-4000-8000-000000000001",
    signedAt: new Date("2026-09-01T00:00:00.000Z"),
    issueDate: new Date("2026-09-01T00:00:00.000Z"),
    validUntil: new Date("2099-01-01T00:00:00.000Z"),
    filePath: `certificates/${STORED_PDF}`,
  };
  mdb.seed("Certificate", [
    { ...common, id: SIGNED, certificateNumber: NUMBER, verificationToken: TOKEN },
    {
      ...common,
      id: WITHDRAWN,
      certificateNumber: WITHDRAWN_NUMBER,
      verificationToken: OTHER_TOKEN,
      deletedAt: new Date("2026-09-20T00:00:00.000Z"),
    },
  ]);
});

const verify = async (number: string, query: Record<string, unknown> = {}): Promise<{ status: number; body: VerifyReply; headers: Record<string, unknown> }> => {
  const res = await call(router, "GET", `/verify/${number}`, { query, baseUrl: "/api/v1/certificates" });
  return { status: res.status, body: res.body as VerifyReply, headers: res.headers };
};

describe("A-293 — the public verdict without the certificate's token is minimal", () => {
  it("a bare number (an already-printed QR code) answers 200, no redirect, with the minimal verdict only", async () => {
    const { status, body, headers } = await verify(NUMBER);

    expect(status).toBe(200);
    expect(headers["location"]).toBeUndefined();
    const data = body.data ?? {};
    expect(Object.keys(data).sort()).toEqual(MINIMAL_KEYS);
    expect(data).toMatchObject({
      found: true,
      valid: true,
      status: "signed",
      revoked: false,
      expired: false,
      withdrawn: false,
      certificateNumber: NUMBER,
      type: "calibration",
      issueDate: "2026-09-01T00:00:00.000Z",
      validUntil: "2099-01-01T00:00:00.000Z",
      disclosure: "minimal",
    });
    expect(Object.keys(data["integrity"] as object).sort()).toEqual(["algorithm", "hash", "legacyHash", "scheme"]);
    const text = JSON.stringify(body);
    for (const secret of [SERIAL, DEVICE_NAME, signerFirstName, TOKEN, "/document?token="]) {
      expect(text).not.toContain(secret);
    }
  });

  it("a wrong token — same length, another certificate's, shorter, repeated — answers exactly like no token", async () => {
    const bare = (await verify(NUMBER)).body;

    for (const token of [OTHER_TOKEN, TOKEN.slice(0, 31), `${TOKEN}x`, "", [TOKEN, TOKEN]]) {
      limiter.clearMemoryStore();
      const { status, body } = await verify(NUMBER, { token });
      expect({ token, status }).toEqual({ token, status: 200 });
      expect(body).toEqual(bare);
    }
  });

  it("the page's `t` parameter is not the API's: `?t=<token>` is minimal too", async () => {
    const { body } = await verify(NUMBER, { t: TOKEN });

    expect(body.data?.["disclosure"]).toBe("minimal");
  });

  it("an unknown number is unchanged: found false, valid false, a message — nothing else", async () => {
    const { status, body } = await verify("CERT-20260929-A293-9999", { token: TOKEN });

    expect(status).toBe(200);
    expect(body.data).toEqual({ found: false, valid: false, message: "No certificate matches this number." });
  });
});

describe("A-293 — the certificate's own token unlocks the full verdict", () => {
  it("returns today's full payload, disclosure full, a verifyUrl carrying the token and the stored-PDF capability", async () => {
    const { status, body } = await verify(NUMBER, { token: TOKEN });

    expect(status).toBe(200);
    const data = body.data ?? {};
    expect(data).toMatchObject({
      found: true,
      valid: true,
      disclosure: "full",
      certificateNumber: NUMBER,
      standard: "ISO 17025",
      device: { name: DEVICE_NAME, serialNumber: SERIAL },
      signedBy: `${signerFirstName} Tech`,
      signedAt: "2026-09-01T00:00:00.000Z",
      verifyUrl: `https://callibrator.test/api/v1/certificates/verify/${NUMBER}?token=${TOKEN}`,
    });
    expect(data["integrityHash"]).toBe((data["integrity"] as { legacyHash: string }).legacyHash);
    expect(data["document"]).toMatchObject({ certificateNumber: NUMBER, verifyUrl: data["verifyUrl"] });
    expect(String(data["documentUrl"])).toMatch(
      new RegExp(`^/api/v1/certificates/verify/${NUMBER}/document\\?token=\\d+\\.`),
    );
  });

  it("the hashes are the same in both verdicts, so an old printout is checked either way", async () => {
    const minimal = (await verify(NUMBER)).body.data ?? {};
    const full = (await verify(NUMBER, { token: TOKEN })).body.data ?? {};

    expect(minimal["integrity"]).toEqual(full["integrity"]);
  });

  it("a withdrawn signed certificate with its token: full, never valid, no document", async () => {
    const { body } = await verify(WITHDRAWN_NUMBER, { token: OTHER_TOKEN });

    expect(body.data).toMatchObject({ disclosure: "full", withdrawn: true, valid: false, document: null, documentUrl: null });
  });

  it("another certificate's token does not unlock this one", async () => {
    const { body } = await verify(WITHDRAWN_NUMBER, { token: TOKEN });

    expect(body.data?.["disclosure"]).toBe("minimal");
    expect(body.data).toMatchObject({ withdrawn: true, valid: false });
  });
});

describe("A-293 — per-address request budgets", () => {
  it("the 61st token-less verdict in the window is a 429 with Retry-After; a wrong token counts the same", async () => {
    for (let i = 0; i < 59; i += 1) {
      expect((await verify(NUMBER)).status).toBe(200);
    }
    expect((await verify(NUMBER, { token: OTHER_TOKEN })).status).toBe(200);

    const refused = await verify(NUMBER, { token: OTHER_TOKEN });

    expect(refused.status).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(refused.body).toMatchObject({ success: false, status: 429, data: null });
    expect(refused.body.retryAfter).toBe(Number(refused.headers["retry-after"]));
  });

  it("an unknown number counts against the token-less budget too", async () => {
    for (let i = 0; i < 60; i += 1) {
      await verify(`CERT-20260929-A293-${String(1000 + i)}`);
    }

    expect((await verify("CERT-20260929-A293-9999")).status).toBe(429);
  });

  it("the certificate's own token is not held to the token-less budget", async () => {
    for (let i = 0; i < 60; i += 1) {
      await verify(NUMBER);
    }
    expect((await verify(NUMBER)).status).toBe(429);

    const scanned = await verify(NUMBER, { token: TOKEN });

    expect(scanned.status).toBe(200);
    expect(scanned.body.data?.["disclosure"]).toBe("full");
  });

  it("every verification counts against the 300 budget, and the stored-document route shares it", async () => {
    for (let i = 0; i < 300; i += 1) {
      expect((await verify(NUMBER, { token: TOKEN })).status).toBe(200);
    }

    const verdict = await verify(NUMBER, { token: TOKEN });
    const documentFetch = await call(router, "GET", `/verify/${NUMBER}/document`, {
      query: { token: "1.abc" },
      baseUrl: "/api/v1/certificates",
    });

    expect(verdict.status).toBe(429);
    expect(verdict.headers["retry-after"]).toBeDefined();
    expect(documentFetch.status).toBe(429);
  });
});
