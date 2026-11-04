/**
 * P21-15 part 4 (ADR-140 § 6; spec v2 § 3 – § 5) — personal e-signatures on certificates:
 *  - the approve and sign steps AFFIX the actor's e-signature automatically (meaning `approved`) in
 *    their own transaction when it has an active one; without one the step behaves exactly as before,
 *    writing no application. Either way the certificate's tenant-key digital signature (ADR-040) is
 *    exactly what the sign request carried — the e-signature never touches it;
 *  - `POST /certificates/:certificateId/esignatures`: `performed` by the calibrator, `approved` by the
 *    approver or signer once approved; the state 409s and the 403s with their codes and explanations;
 *  - `GET /certificates/:certificateId/esignatures`: `intact`, then `changed` once the content changes;
 *  - the public verdict of a certificate application (`cert-data-v1` recomputed; `revoked` beside it),
 *    and the certificate's FULL verification listing the e-signatures with their links.
 *
 * REAL: the routers' chains, the controllers, certificate.service's locked transitions, the e-signature
 * services, the models and the tenant hooks over memoryDb. DOUBLED: the password check
 * (auth.service#passIsValid) and the KMS wrap. Synthetic data only.
 */
import { createHash, generateKeyPairSync, verify as rsaVerify } from "node:crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type { Row } from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as CertificatesRoute from "../../routes/api/certificates.route";
import type * as PublicRoute from "../../routes/api/publicEsignatures.route";
import type SigningKeyWrapModule from "../../services/signingKeyWrap.service";
import type * as UserEsignatureService from "../../services/userEsignature.service";
import type * as ApplicationService from "../../services/esignatureApplication.service";
import type ModelsModule from "../../models";
import { runForTenant } from "../../utils/jobContext.util";
import { canonicalCertificateData, esignatureSignedPayload } from "@callibrator/contracts/esignatures";

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
jest.mock("../../config/socket", () => ({ getIo: () => ({ to: () => ({ emit: () => undefined }) }) }));

interface PasswordCheck {
  passIsValid(userId: string, password: string): Promise<{ data: { valid: boolean } }>;
}

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const authService = jest.requireActual<PasswordCheck>("../../services/auth.service");
const certificates = jest.requireActual<typeof CertificatesRoute>("../../routes/api/certificates.route");
const pub = jest.requireActual<typeof PublicRoute>("../../routes/api/publicEsignatures.route");
const signingKeyWrap = jest.requireActual<typeof SigningKeyWrapModule>("../../services/signingKeyWrap.service");
const mine = jest.requireActual<typeof UserEsignatureService>("../../services/userEsignature.service");
const service = jest.requireActual<typeof ApplicationService>("../../services/esignatureApplication.service");
const models = jest.requireActual<typeof ModelsModule>("../../models");
const memory = (jest.requireMock<{ db: { transaction: <T>(work: (t: never) => Promise<T>) => Promise<T> } }>("../../config")).db;
const limiter = jest.requireActual<{ clearMemoryStore(): void }>("../../services/rateLimiter.redis.service");

const KEY = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>';
const DEVICE = "a1000000-0000-4000-8000-000000000001";
const RECORD = "a3000000-0000-4000-8000-000000000001";
const PENDING = "a2000000-0000-4000-8000-000000000001";
const APPROVED = "a2000000-0000-4000-8000-000000000002";
const DRAFT = "a2000000-0000-4000-8000-000000000003";
const REVOKED = "a2000000-0000-4000-8000-000000000004";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REAUTH = { authMethod: "password", authPayload: "correct horse", meaning: "Reviewed and approved" };
const SIGN_BODY = { ...REAUTH, digitalSignature: "c2lnbmF0dXJlLWZyb20tdGhlLWNsaWVudA==", digitalSignatureKeyId: "tenant-key-7" };
const CRED = { authMethod: "password", credential: "correct horse" };

interface Res {
  status: number;
  body: { data?: unknown; message?: string; code?: string };
}

let tenantA: string;
let calibrator: Principal;
let reviewer: Principal;
let outsider: Principal;

const seedUser = (p: Principal, firstName: string): void => {
  mdb.seed("User", { id: p.id, tenantId: p.tenantId, username: p.username, firstName, lastName: "Sintetis", email: `${p.username}@x.test`, password: "x", roleId: p.role.id, status: "ACTIVE", isActive: true });
};
const seedEsig = (userId: string): void => {
  mdb.seed("UserEsignature", {
    id: `a5000000-0000-4000-8000-${userId.slice(-12)}`,
    tenantId: tenantA,
    userId,
    version: 1,
    specimenSvg: SPECIMEN,
    publicKeyPem: KEY.publicKey,
    privateKeyEnc: "synthetic-envelope",
    keyFingerprint: mine.fingerprintOf(KEY.publicKey),
    status: "active",
  });
};

beforeEach(() => {
  mdb.reset();
  limiter.clearMemoryStore();
  grantAllMenus();
  jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: true } });
  jest.spyOn(signingKeyWrap, "unwrapPrivateKey").mockReturnValue(KEY.privateKey);
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  calibrator = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  reviewer = fx.principal(fx.tenantA, "CALIBRATOR_ADMIN");
  outsider = fx.principal(fx.tenantA, "TECHNICIAN");
  mdb.seed("Tenant", fx.snapshot(fx.tenantA));
  mdb.seed("Tenant", fx.snapshot(fx.tenantB));
  seedUser(calibrator, "Ani");
  seedUser(reviewer, "Budi");
  seedUser(outsider, "Citra");
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: tenantA, name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B. Braun", model: "Perfusor" });
  mdb.seed("CalibrationRecord", { id: RECORD, tenantId: tenantA, deviceId: DEVICE, performedBy: calibrator.id, calibrationDate: new Date("2030-01-15T00:00:00.000Z"), isCompliant: true, entryKind: "full_record", isDeleted: false });
  const base = { tenantId: tenantA, deviceId: DEVICE, calibrationRecordId: RECORD, calibratedBy: calibrator.id, createdBy: calibrator.id, type: "calibration", summary: "Within tolerance", validUntil: new Date("2031-01-15T00:00:00.000Z") };
  mdb.seed("Certificate", [
    { ...base, id: PENDING, certificateNumber: "CERT-A-0001", status: "pending_approval" },
    { ...base, id: APPROVED, certificateNumber: "CERT-A-0002", status: "approved", approvedBy: reviewer.id, issueDate: new Date("2030-01-16T00:00:00.000Z") },
    { ...base, id: DRAFT, certificateNumber: "CERT-A-0003", status: "draft" },
    { ...base, id: REVOKED, certificateNumber: "CERT-A-0004", status: "revoked", approvedBy: reviewer.id },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal | null, method: string, url: string, body: unknown = {}, query: Record<string, unknown> = {}): Promise<Res> => {
  as(principal);
  return call(certificates, method, url, { body, query, routeFile: "api/certificates.route.ts", baseUrl: "/api/v1/certificates" }) as Promise<Res>;
};
const stored = (id: string): Row => mdb.rows("Certificate").find((c) => c["id"] === id) as Row;
const apps = (): Row[] => mdb.rows("EsignatureApplication");
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  Object.assign(live.rowsOf(live.model(model)).find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const expectCode = (res: Res, status: number, code: string, message: string): void => {
  expect([res.status, res.body.code, res.body.message]).toEqual([status, code, message]);
};
const hashOf = (id: string): string => createHash("sha256").update(canonicalCertificateData(stored(id) as never), "utf8").digest("hex");

describe("the approve and sign steps affix the actor's e-signature automatically (§ 4)", () => {
  it("without an e-signature, approve and sign behave exactly as before: no application; the digital signature is what the request carried", async () => {
    expect((await send(reviewer, "POST", `/${PENDING}/approve`, REAUTH)).status).toBe(200);
    expect((await send(reviewer, "POST", `/${PENDING}/sign`, SIGN_BODY)).status).toBe(200);
    expect(stored(PENDING)).toMatchObject({ status: "signed", approvedBy: reviewer.id, signedBy: reviewer.id, digitalSignature: SIGN_BODY.digitalSignature, digitalSignatureKeyId: SIGN_BODY.digitalSignatureKeyId });
    expect(apps()).toEqual([]);
    expect(mdb.rows("ESignatureRecord").map((r) => [r["entityType"], r["action"]])).toEqual([
      ["Certificate", "approve"],
      ["Certificate", "sign"],
    ]);
  });

  it("with one: the approval is affixed in the approve step (cert-data-v1, the personal key); the same person signing adds no second one; the digital signature is unchanged", async () => {
    seedEsig(reviewer.id);
    expect((await send(reviewer, "POST", `/${PENDING}/approve`, REAUTH)).status).toBe(200);
    const [row] = apps();
    expect(row).toMatchObject({ documentType: "certificate", documentId: PENDING, documentTitle: "Certificate CERT-A-0001", signerUserId: reviewer.id, meaning: "approved", contentScheme: "cert-data-v1", contentHash: hashOf(PENDING), authMethod: "password" });
    const payload = esignatureSignedPayload({
      tenantId: tenantA,
      applicationId: String(row?.["id"]),
      esignatureId: String(row?.["esignatureId"]),
      keyFingerprint: mine.fingerprintOf(KEY.publicKey),
      documentType: "certificate",
      documentId: PENDING,
      contentScheme: "cert-data-v1",
      contentHash: hashOf(PENDING),
      meaning: "approved",
      signerUserId: reviewer.id,
      signedAt: (row?.["signedAt"] as Date).toISOString(),
      authMethod: "password",
    });
    expect(rsaVerify("sha256", Buffer.from(payload), KEY.publicKey, Buffer.from(String(row?.["signatureValue"]), "base64"))).toBe(true);
    expect((await send(reviewer, "POST", `/${PENDING}/sign`, SIGN_BODY)).status).toBe(200);
    expect(apps()).toHaveLength(1);
    expect(stored(PENDING)).toMatchObject({ status: "signed", digitalSignature: SIGN_BODY.digitalSignature, digitalSignatureKeyId: SIGN_BODY.digitalSignatureKeyId });
    expect(hashOf(PENDING)).toBe(row?.["contentHash"]);
  });

  it("a signer other than the approver gets its own approval at signing", async () => {
    seedEsig(calibrator.id);
    jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: true } });
    const res = await send(calibrator, "POST", `/${APPROVED}/sign`, SIGN_BODY);
    expect(res.status).toBe(200);
    expect(apps()).toEqual([expect.objectContaining({ documentId: APPROVED, signerUserId: calibrator.id, meaning: "approved" })]);
    expect(stored(APPROVED)["digitalSignature"]).toBe(SIGN_BODY.digitalSignature);
  });

  it("an MFA step is recorded as mfa (the step's own method, no second credential)", async () => {
    seedEsig(reviewer.id);
    const certificate = await runForTenant(tenantA, () => models.Certificate.findOne({ where: { id: APPROVED } }));
    const id = await runForTenant(tenantA, () => memory.transaction((t) => service.autoApplyApproval(t, certificate as never, reviewer.id, { authMethod: "mfa" })));
    expect(apps()).toEqual([expect.objectContaining({ id, authMethod: "mfa", ipAddress: null, meaning: "approved" })]);
  });

  it("a failed step writes no application (the same transaction)", async () => {
    seedEsig(reviewer.id);
    jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: false } });
    expect((await send(reviewer, "POST", `/${PENDING}/approve`, REAUTH)).status).toBe(401);
    expect([apps().length, stored(PENDING)["status"]]).toEqual([0, "pending_approval"]);
  });
});

describe("POST and GET /certificates/:certificateId/esignatures (§ 4)", () => {
  it("performed by the calibrator; approved by the approver once approved; listed intact, then changed", async () => {
    seedEsig(calibrator.id);
    seedEsig(reviewer.id);
    const performed = await send(calibrator, "POST", `/${APPROVED}/esignatures`, { meaning: "performed", ...CRED });
    expect([performed.status, (performed.body.data as Record<string, unknown>)["integrity"]]).toEqual([201, "intact"]);
    expect((await send(reviewer, "POST", `/${APPROVED}/esignatures`, { meaning: "approved", ...CRED })).status).toBe(201);
    const again = await send(reviewer, "POST", `/${APPROVED}/esignatures`, { meaning: "approved", ...CRED });
    expect([again.status, again.body.code]).toEqual([409, "ESIG_ALREADY_APPLIED"]);
    expect(again.body.message).toMatch(/^You signed this certificate as approved on \d{4}-\d{2}-\d{2}\.$/);
    const list = (await send(outsider, "GET", `/${APPROVED}/esignatures`)).body.data as Record<string, unknown>[];
    expect(list.map((a) => [a["meaning"], a["integrity"], a["specimenSvg"]])).toEqual([
      ["performed", "intact", SPECIMEN],
      ["approved", "intact", SPECIMEN],
    ]);
    setRow("Certificate", APPROVED, { summary: "Edited after approval" });
    expect(((await send(outsider, "GET", `/${APPROVED}/esignatures`)).body.data as Record<string, unknown>[]).map((a) => a["integrity"])).toEqual(["changed", "changed"]);
  });

  it("the refusals, each with its code and explanation", async () => {
    seedEsig(outsider.id);
    seedEsig(reviewer.id);
    expectCode(await send(reviewer, "POST", `/${DRAFT}/esignatures`, { meaning: "approved", ...CRED }), 409, "CERT_NOT_APPROVED", "This certificate is in `draft`; it must be approved (POST /certificates/:id/approve) before an approval e-signature is applied.");
    expectCode(await send(outsider, "POST", `/${APPROVED}/esignatures`, { meaning: "approved", ...CRED }), 403, "ESIG_NOT_APPROVER", "Only the person who approved or signed this certificate signs it as approved.");
    expectCode(await send(outsider, "POST", `/${APPROVED}/esignatures`, { meaning: "performed", ...CRED }), 403, "ESIG_NOT_PERFORMER", "Only the person who performed this calibration signs its certificate as performed.");
    expectCode(await send(reviewer, "POST", `/${REVOKED}/esignatures`, { meaning: "approved", ...CRED }), 409, "CERT_REVOKED", "This certificate was revoked; a revoked certificate is not signed.");
    expect((await send(calibrator, "POST", `/${APPROVED}/esignatures`, { meaning: "performed", ...CRED })).body.code).toBe("ESIG_NONE");
    expect((await send(reviewer, "POST", `/${MISSING}/esignatures`, { meaning: "approved", ...CRED })).status).toBe(404);
    expect((await send(reviewer, "GET", `/${MISSING}/esignatures`)).status).toBe(404);
    expect((await send(reviewer, "POST", `/${APPROVED}/esignatures`, { meaning: "reviewed", ...CRED })).status).toBe(400);
    expect(apps()).toEqual([]);
  });
});

describe("verification (§ 4, § 5)", () => {
  it("the e-signature's public verdict recomputes cert-data-v1; a revoked certificate is said beside it; the certificate's full verdict lists its e-signatures", async () => {
    seedEsig(reviewer.id);
    await send(reviewer, "POST", `/${PENDING}/approve`, REAUTH);
    const row = apps()[0] as Row;
    as(null);
    const verdict = (await call(pub, "GET", `/${String(row["id"])}`, { query: { token: row["verificationToken"] }, baseUrl: "/api/v1/public/esignatures" })) as Res;
    expect(verdict.body.data).toMatchObject({
      verdict: "valid",
      documentType: "certificate",
      documentTitle: "Certificate CERT-A-0001",
      contentScheme: "cert-data-v1",
      documentState: "current",
      summary: { deviceName: "Infusion pump", serialNumber: "SN-9", calibrationDate: "2030-01-15", dueDate: "2031-01-15", isCompliant: true },
    });
    const pairs = (verdict.body.data as Record<string, unknown>)["canonicalContent"] as string[][];
    expect(createHash("sha256").update(JSON.stringify(pairs), "utf8").digest("hex")).toBe(row["contentHash"]);

    await send(reviewer, "POST", `/${PENDING}/sign`, SIGN_BODY);
    const token = String(stored(PENDING)["verificationToken"]);
    const full = (await send(null, "GET", "/verify/CERT-A-0001", {}, { token })).body.data as Record<string, unknown>;
    expect(full["esignatures"]).toEqual([
      { meaning: "approved", name: expect.any(String) as unknown, role: null, organisation: "Hospital A", signedAt: expect.any(String) as unknown, specimenSvg: SPECIMEN, verifyUrl: expect.stringContaining(String(row["id"])) as unknown },
    ]);
    const minimal = (await send(null, "GET", "/verify/CERT-A-0001")).body.data as Record<string, unknown>;
    expect(minimal).not.toHaveProperty("esignatures");

    setRow("Certificate", PENDING, { status: "revoked" });
    as(null);
    const revoked = (await call(pub, "GET", `/${String(row["id"])}`, { query: { token: row["verificationToken"] }, baseUrl: "/api/v1/public/esignatures" })) as Res;
    expect(revoked.body.data).toMatchObject({ verdict: "valid", documentState: "revoked" });
    setRow("Certificate", PENDING, { status: "signed", deletedAt: new Date("2030-03-01T00:00:00.000Z"), calibrationRecordId: null, summary: "Changed" });
    as(null);
    const withdrawn = (await call(pub, "GET", `/${String(row["id"])}`, { query: { token: row["verificationToken"] }, baseUrl: "/api/v1/public/esignatures" })) as Res;
    expect(withdrawn.body.data).toMatchObject({ verdict: "content_changed", documentState: "voided", documentStateAt: "2030-03-01", summary: { calibrationDate: null, isCompliant: null } });
  });

  it("a certificate application whose certificate and device are gone reads as blank, never a failure", async () => {
    seedEsig(reviewer.id);
    await send(reviewer, "POST", `/${PENDING}/approve`, REAUTH);
    const row = apps()[0] as Row;
    const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
    const devices = live.rowsOf(live.model("CalibrationDevice"));
    devices.splice(0, devices.length);
    as(null);
    const blankDevice = (await call(pub, "GET", `/${String(row["id"])}`, { query: { token: row["verificationToken"] }, baseUrl: "/api/v1/public/esignatures" })) as Res;
    expect(blankDevice.body.data).toMatchObject({ summary: { deviceName: null, brand: null, model: null, serialNumber: null } });
    const certs = live.rowsOf(live.model("Certificate"));
    certs.splice(0, certs.length);
    as(null);
    const gone = (await call(pub, "GET", `/${String(row["id"])}`, { query: { token: row["verificationToken"] }, baseUrl: "/api/v1/public/esignatures" })) as Res;
    expect(gone.body.data).toMatchObject({ documentState: null, canonicalContent: null, summary: null });
  });
});
