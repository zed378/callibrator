/**
 * Q-50 (ADR-107) — signing a certificate snapshots what it prints, and from
 * then on the certificate is printed from the snapshot and hashed v3.
 *
 * ISO/IEC 17025 7.8: an issued certificate's content is fixed. Before ADR-107
 * the issuer's name and address, the instrument and the people were read LIVE
 * every time the document was built, so a tenant rename or move, a relabelled
 * device or a renamed user changed an already-signed certificate.
 *
 * REAL router, validateUuid, dynamicAccess (matrix granted),
 * denyPlatformAuthoring, validate, controller, certificate service (the locked
 * transition, the Part 11 ESignatureRecord, the audit row) and
 * certificateDocument service, on the REAL models and tenant hooks
 * (fixtures/memoryDb). Doubled: the signer's password check.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type { Row } from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/certificates.route";
import type * as DocumentService from "../../services/certificateDocument.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
// The public verification budget counts in memory (Redis absent), as in certificateVerify.a293.
jest.mock("../../services/redis.service", () => ({
  ...jest.requireActual<Record<string, unknown>>("../../services/redis.service"),
  getRedisConnection: () => null,
}));

interface PasswordCheck {
  passIsValid(userId: string, password: string): Promise<{ data: { valid: boolean } }>;
}

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const authService = jest.requireActual<PasswordCheck>("../../services/auth.service");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/certificates.route");
const limiter = jest.requireActual<{ clearMemoryStore(): void }>("../../services/rateLimiter.redis.service");
const { INTEGRITY_SCHEME_V2, INTEGRITY_SCHEME_V3 } = jest.requireActual<typeof DocumentService>(
  "../../services/certificateDocument.service",
);

const DEVICE = "a1000000-0000-4000-8000-000000000001";
const APPROVED = "a2000000-0000-4000-8000-000000000003";
const OLD_SIGNED = "a2000000-0000-4000-8000-000000000004";
const REAUTH = { authMethod: "password", authPayload: "correct horse", meaning: "Signed as issuing laboratory" };
const SIGN_BODY = { ...REAUTH, digitalSignature: "c2lnbmF0dXJl", digitalSignatureKeyId: "key-a-1" };

let owner: Principal;
let reviewer: Principal;
/** The STORED rows (memoryDb.seed returns them), so a test can rename them after signing. */
let tenantRow: Row;
let deviceRow: Row;
let ownerRow: Row;

const seedUser = (p: Principal, firstName: string, lastName: string): Row =>
  mdb.seed("User", {
    id: p.id,
    tenantId: p.tenantId,
    username: p.username,
    name: p.username,
    firstName,
    lastName,
    email: `${p.username}@${p.tenantId.slice(0, 8)}.test`,
    password: "not-a-hash",
    roleId: p.role.id,
    status: "ACTIVE",
    isActive: true,
  })[0] as Row;

beforeEach(() => {
  mdb.reset();
  limiter.clearMemoryStore();
  grantAllMenus();
  jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: true } });
  const fx = twoTenants();
  owner = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  reviewer = fx.principal(fx.tenantA, "CALIBRATOR_ADMIN");
  tenantRow = mdb.seed("Tenant", {
    ...fx.snapshot(fx.tenantA),
    email: "lab@sehat.example.id",
    phone: "+62 21-555 0100",
    address: "Jl. Kesehatan No. 10",
    city: "Jakarta Pusat",
    state: "DKI Jakarta",
    zipCode: "10110",
    country: "Indonesia",
    website: "https://sehat.example.id",
  })[0] as Row;
  mdb.seed("Tenant", fx.snapshot(fx.tenantB));
  ownerRow = seedUser(owner, "Ani", "Putri");
  seedUser(reviewer, "Budi", "Santoso");
  deviceRow = mdb.seed("CalibrationDevice", {
    id: DEVICE,
    tenantId: fx.tenantA.id,
    name: "Infusion pump",
    serialNumber: "SN-9",
    manufacturer: "B. Braun",
    model: "Perfusor",
  })[0] as Row;
  mdb.seed("Certificate", [
    {
      id: APPROVED,
      tenantId: fx.tenantA.id,
      deviceId: DEVICE,
      certificateNumber: "CERT-A-0003",
      status: "approved",
      calibratedBy: owner.id,
      approvedBy: reviewer.id,
      createdBy: owner.id,
    },
    {
      // Signed BEFORE ADR-107: no snapshot. Nothing is invented for it.
      id: OLD_SIGNED,
      tenantId: fx.tenantA.id,
      deviceId: DEVICE,
      certificateNumber: "CERT-A-0004",
      status: "signed",
      calibratedBy: owner.id,
      approvedBy: reviewer.id,
      signedBy: reviewer.id,
      signedAt: new Date("2026-09-01T08:00:00.000Z"),
      digitalSignature: "b2xk",
      digitalSignatureKeyId: "key-old",
      createdBy: owner.id,
    },
  ]);
});

const stored = (id: string): Row => {
  const row = mdb.rows("Certificate").find((c) => c["id"] === id);
  if (!row) {
    throw new Error(`certificate ${id} is not seeded`);
  }
  return row;
};

const documentOf = async (id: string): Promise<Record<string, unknown>> => {
  const res = await call(router, "GET", `/${id}/document`, { baseUrl: "/api/v1/certificates" });
  expect(res.status).toBe(200);
  return (res.body as { data: Record<string, unknown> }).data;
};

describe("ADR-107: signing snapshots what the certificate prints", () => {
  it("the sign step stores the issuer, instrument and people as they stand at signing, in the sign transaction", async () => {
    as(owner);
    const res = await call(router, "POST", `/${APPROVED}/sign`, { body: SIGN_BODY, baseUrl: "/api/v1/certificates" });
    expect(res.status).toBe(200);

    expect(stored(APPROVED)["signedSnapshot"]).toEqual({
      version: 1,
      issuer: {
        name: tenantRow["name"],
        email: "lab@sehat.example.id",
        phone: "+62 21-555 0100",
        address: "Jl. Kesehatan No. 10",
        city: "Jakarta Pusat",
        state: "DKI Jakarta",
        zipCode: "10110",
        country: "Indonesia",
        website: "https://sehat.example.id",
      },
      device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B. Braun", model: "Perfusor" },
      calibratedBy: "Ani Putri",
      approvedBy: "Budi Santoso",
      signedBy: "Ani Putri",
    });
    // Written by the same committed transaction as the signature itself.
    const writes = mdb.committed().filter((w) => w.model === "Certificate" && w.id === APPROVED);
    expect(writes.some((w) => JSON.stringify(w.values).includes("signedSnapshot"))).toBe(true);
  });

  it("the signed certificate prints v3, from the snapshot", async () => {
    as(owner);
    await call(router, "POST", `/${APPROVED}/sign`, { body: SIGN_BODY, baseUrl: "/api/v1/certificates" });
    const doc = await documentOf(APPROVED);
    expect(doc["contentAsOf"]).toBe("signing");
    expect((doc["integrity"] as { scheme: string }).scheme).toBe(INTEGRITY_SCHEME_V3);
    expect((doc["issuer"] as { address: string }).address).toBe("Jl. Kesehatan No. 10");
  });

  it("a tenant rename and move, a relabelled device and a renamed user AFTER signing change nothing on it", async () => {
    as(owner);
    await call(router, "POST", `/${APPROVED}/sign`, { body: SIGN_BODY, baseUrl: "/api/v1/certificates" });
    const before = await documentOf(APPROVED);

    tenantRow["name"] = "Lab Renamed";
    tenantRow["address"] = "Jl. Baru 1";
    tenantRow["city"] = "Bandung";
    tenantRow["phone"] = "+62 22 700 1000";
    deviceRow["name"] = "Pump (relabelled)";
    deviceRow["serialNumber"] = "SN-9X";
    ownerRow["lastName"] = "Wijaya";

    const after = await documentOf(APPROVED);
    expect(after).toEqual(before);
  });

  it("a certificate signed before ADR-107 keeps v2 and its live printing — no snapshot is invented, and reading it writes nothing", async () => {
    as(owner);
    const committedBefore = mdb.committed().length;
    const doc = await documentOf(OLD_SIGNED);
    expect((doc["integrity"] as { scheme: string }).scheme).toBe(INTEGRITY_SCHEME_V2);
    expect(doc["contentAsOf"]).toBe("live");
    expect(stored(OLD_SIGNED)["signedSnapshot"] ?? null).toBeNull();
    expect(mdb.committed().length).toBe(committedBefore);
  });

  it("an unsigned (approved) certificate prints the live rows, v2", async () => {
    as(owner);
    const doc = await documentOf(APPROVED);
    expect(doc["contentAsOf"]).toBe("live");
    expect((doc["integrity"] as { scheme: string }).scheme).toBe(INTEGRITY_SCHEME_V2);
    tenantRow["address"] = "Jl. Baru 1";
    expect(((await documentOf(APPROVED))["issuer"] as { address: string }).address).toBe("Jl. Baru 1");
  });

  it("a refused signing (wrong credential) stores no snapshot", async () => {
    jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: false } });
    as(owner);
    const res = await call(router, "POST", `/${APPROVED}/sign`, { body: SIGN_BODY, baseUrl: "/api/v1/certificates" });
    expect(res.status).toBe(401);
    expect(stored(APPROVED)["signedSnapshot"] ?? null).toBeNull();
    expect(stored(APPROVED)["status"]).toBe("approved");
  });

  it("the public verification page reports v3, and the issuer and instrument as signed, after a rename", async () => {
    as(owner);
    await call(router, "POST", `/${APPROVED}/sign`, { body: SIGN_BODY, baseUrl: "/api/v1/certificates" });
    const signedName = tenantRow["name"];
    tenantRow["name"] = "Lab Renamed";
    deviceRow["serialNumber"] = "SN-9X";

    const token = String(stored(APPROVED)["verificationToken"]);
    const verify = async (query: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await call(router, "GET", "/verify/CERT-A-0003", { query, baseUrl: "/api/v1/certificates" });
      expect(res.status).toBe(200);
      return (res.body as { data: Record<string, unknown> }).data;
    };

    const minimal = await verify({});
    expect(minimal["disclosure"]).toBe("minimal");
    expect(minimal["issuedTo"]).toBe(signedName);
    expect((minimal["integrity"] as { scheme: string }).scheme).toBe(INTEGRITY_SCHEME_V3);
    expect(minimal).not.toHaveProperty("device");

    const full = await verify({ token });
    expect(full["disclosure"]).toBe("full");
    expect(full["issuedTo"]).toBe(signedName);
    expect(full["device"]).toEqual({ name: "Infusion pump", serialNumber: "SN-9" });
    expect((full["integrity"] as { scheme: string }).scheme).toBe(INTEGRITY_SCHEME_V3);
    expect((full["document"] as { issuer: { address: string } }).issuer.address).toBe("Jl. Kesehatan No. 10");
  });

  it("the public verification page still reports v2 for a certificate signed before ADR-107", async () => {
    const res = await call(router, "GET", "/verify/CERT-A-0004", { query: {}, baseUrl: "/api/v1/certificates" });
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect((data["integrity"] as { scheme: string }).scheme).toBe(INTEGRITY_SCHEME_V2);
    expect(data["issuedTo"]).toBe(tenantRow["name"]);
  });
});
