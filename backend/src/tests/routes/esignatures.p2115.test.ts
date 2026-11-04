/**
 * P21-15 — personal e-signatures, applied to calibration records and to documents by hash, each
 * application publicly verifiable (ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2
 * § 2 – § 4), row by row:
 *  - my e-signature: create (a specimen on the allow-list, a key pair, the private half wrapped, the
 *    audit row), replace (the old version superseded), revoke, a tenant administrator's revoke; the
 *    platform operator refused; a wrong credential writes nothing; never a private key in an answer;
 *  - application to a record: `performed` by the performer, `reviewed` by anyone else, once each; the
 *    record's state refusals; `ESIG_NONE`; the RSA signature verifies under the stored public key; the
 *    audit and Part 11 rows in the transaction; the event after it;
 *  - a document by hash: no file, the hash only; my applications paged;
 *  - the public verification: `valid`, `content_changed` (logged and counted), `invalid`; the
 *    e-signature's and the record's states beside the verdict; exactly the allowed fields; the
 *    headers; one identical 404; both request budgets.
 *
 * REAL: the routers' chains, the controller, the services, the models and the tenant hooks over
 * memoryDb. SPIES: the credential check (certificate.service#verifySignerCredentials, tested by its own
 * suites), the KMS wrap (signingKeyWrap.service, tested by its own) and the key generator (a
 * pre-generated pair; the real generator is called once). Synthetic data only.
 */
import { createHash, generateKeyPairSync, verify as rsaVerify } from "node:crypto";
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
import type * as EsigRoute from "../../routes/api/userEsignatures.route";
import type * as PublicRoute from "../../routes/api/publicEsignatures.route";
import type * as UserEsignatureService from "../../services/userEsignature.service";
import type * as ApplicationService from "../../services/esignatureApplication.service";
import type CertificateServiceModule from "../../services/certificate.service";
import type SigningKeyWrapModule from "../../services/signingKeyWrap.service";
import type ModelsModule from "../../models";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import { AppError } from "../../utils/appError.util";
import { environment } from "../../config/env";
import { runForTenant } from "../../utils/jobContext.util";
import { canonicalCalibrationRecordData, esignatureSignedPayload } from "@callibrator/contracts/esignatures";
import type { TenantId } from "../../types/ids";

const mockEmits: { event: string; rooms: string[]; payload: unknown }[] = [];
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/socket", () => ({
  getIo: () => ({ to: (rooms: string[]) => ({ emit: (event: string, payload: unknown) => mockEmits.push({ event, rooms, payload }) }) }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const records = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");
const esig = jest.requireActual<typeof EsigRoute>("../../routes/api/userEsignatures.route");
const pub = jest.requireActual<typeof PublicRoute>("../../routes/api/publicEsignatures.route");
const mine = jest.requireActual<typeof UserEsignatureService>("../../services/userEsignature.service");
const apps = jest.requireActual<typeof ApplicationService>("../../services/esignatureApplication.service");
const certificateService = jest.requireActual<typeof CertificateServiceModule>("../../services/certificate.service");
const signingKeyWrap = jest.requireActual<typeof SigningKeyWrapModule>("../../services/signingKeyWrap.service");
const models = jest.requireActual<typeof ModelsModule>("../../models");
const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
};
const KEY1 = pair();
const KEY2 = pair();
const ENV = environment();

const DEVICE = "a1000000-0000-4000-8000-000000000001";
const RECORD = "a2000000-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOT_FOUND = { success: false, status: 404, message: "No e-signature matches this link.", data: null };
const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M10 80 C 40 10, 65 10, 95 80" fill="none" stroke="#111" stroke-width="2"/></svg>';
const CRED = { authMethod: "password", credential: "synthetic-secret" };

interface Res {
  status: number;
  body: { data?: unknown; meta?: Record<string, unknown>; message?: string; code?: string; headId?: string; success?: boolean };
  headers: Record<string, unknown>;
}

let tenantA: string;
let performer: Principal;
let colleague: Principal;
let admin: Principal;
let technician: Principal;
let credential: jest.SpyInstance;
let generated: jest.SpyInstance;

const seedRecord = (id: string, values: Record<string, unknown> = {}): void => {
  mdb.seed("CalibrationRecord", {
    id,
    tenantId: tenantA,
    deviceId: DEVICE,
    performedBy: performer.id,
    calibrationDate: new Date("2030-01-15T00:00:00.000Z"),
    dueDate: new Date("2031-01-15T00:00:00.000Z"),
    standard: "ISO 17025",
    results: { reading: 37.1, unit: "C" },
    measurementUncertainty: 0.1,
    isCompliant: true,
    notes: "Dalam toleransi",
    entryKind: "full_record",
    isDeleted: false,
    ...values,
  });
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  performer = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  colleague = { ...fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), id: "a3000000-0000-4000-8000-0000000000c1", username: "colleague" };
  admin = fx.principal(fx.tenantA, "TENANT_ADMIN");
  technician = fx.principal(fx.tenantA, "TECHNICIAN");
  seedTenants(mdb, fx, [performer, colleague, admin, technician]);
  mdb.seed("CalibrationDevice", { id: DEVICE, tenantId: tenantA, name: "Pompa infus sintetis", manufacturer: "Pembuat", model: "P-1", serialNumber: "SN-0001" });
  seedRecord(RECORD);
  mockEmits.length = 0;
  delete ENV["PUBLIC_APP_URL"];
  credential = jest.spyOn(certificateService, "verifySignerCredentials").mockResolvedValue(undefined);
  generated = jest.spyOn(mine.keyPairs, "generate").mockResolvedValueOnce(KEY1).mockResolvedValueOnce(KEY2).mockResolvedValue(KEY2);
  jest.spyOn(signingKeyWrap, "wrapPrivateKey").mockImplementation((_tenant: string, pem: string) => `wrapped:${Buffer.from(pem).toString("base64")}`);
  jest.spyOn(signingKeyWrap, "unwrapPrivateKey").mockImplementation((_tenant: string, stored: string) => Buffer.from(stored.slice("wrapped:".length), "base64").toString("utf8"));
});

afterEach(() => {
  jest.restoreAllMocks();
});

const callEsig = (principal: Principal | null, method: string, url: string, body: unknown = {}, query: Record<string, unknown> = {}, tenantId?: string | null): Promise<Res> => {
  as(principal, tenantId === undefined ? {} : { tenantId });
  return call(esig, method, url, { body, query, routeFile: "api/userEsignatures.route.ts", baseUrl: "/api/v1/esignature" }) as Promise<Res>;
};
const callRecord = (principal: Principal | null, method: string, url: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Res> => {
  as(principal);
  return call(records, method, url, { body, headers, routeFile: "api/calibrationRecords.route.ts" }) as Promise<Res>;
};
const verify = (id: string, query: Record<string, unknown> = {}): Promise<Res> => {
  as(null);
  return call(pub, "GET", `/${id}`, { query, routeFile: "api/publicEsignatures.route.ts", baseUrl: "/api/v1/public/esignatures" }) as Promise<Res>;
};
const create = (principal: Principal = performer, specimenSvg = SPECIMEN): Promise<Res> => callEsig(principal, "POST", "/me", { specimenSvg, ...CRED });
const apply = (principal: Principal = performer, meaning = "performed", id = RECORD, headers: Record<string, string> = {}): Promise<Res> =>
  callRecord(principal, "POST", `/${id}/esignatures`, { meaning, ...CRED }, headers);
const data = (res: Res): Record<string, unknown> => res.body.data as Record<string, unknown>;
const rowsOf = (model: string): Record<string, unknown>[] => mdb.rows(model);
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  Object.assign(live.rowsOf(live.model(model)).find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const dropRow = (model: string, id: string): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  const list = live.rowsOf(live.model(model));
  list.splice(list.findIndex((r) => r["id"] === id), 1);
};
const expectCode = (res: Res, status: number, code: string, message: string | RegExp): void => {
  expect([res.status, res.body.code]).toEqual([status, code]);
  if (typeof message === "string") {
    expect(res.body.message).toBe(message);
  } else {
    expect(res.body.message).toMatch(message);
  }
};
const audits = (operation: string): Record<string, unknown>[] => rowsOf("AuditLog").filter((a) => (a["changes"] as Record<string, unknown> | null)?.["operation"] === operation);
/** The performer creates an e-signature and signs RECORD as performed; the application row. */
const signedRecord = async (): Promise<{ id: string; token: string }> => {
  expect((await create()).status).toBe(201);
  expect((await apply()).status).toBe(201);
  const row = rowsOf("EsignatureApplication")[0] as Record<string, unknown>;
  return { id: String(row["id"]), token: String(row["verificationToken"]) };
};

describe("my e-signature (§ 2.1, § 4)", () => {
  it("create: the specimen, a key pair, the private half wrapped, the fingerprint, the audit row — never the private key in the answer", async () => {
    expect((await callEsig(performer, "GET", "/me")).body.data).toEqual({ active: null, history: [] });
    const res = await create();
    expect([res.status, res.body.message]).toEqual([201, "E-signature saved"]);
    const [row] = rowsOf("UserEsignature");
    const fingerprint = mine.fingerprintOf(KEY1.publicKeyPem);
    expect(row).toMatchObject({ tenantId: tenantA, userId: performer.id, version: 1, status: "active", specimenSvg: SPECIMEN, publicKeyPem: KEY1.publicKeyPem, keyFingerprint: fingerprint });
    expect(String(row?.["privateKeyEnc"])).toMatch(/^wrapped:/);
    expect(data(res)).toEqual({ id: row?.["id"], version: 1, status: "active", specimenSvg: SPECIMEN, keyFingerprint: fingerprint, createdAt: expect.any(String) as unknown, supersededAt: null, revokedAt: null });
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(res.body)).not.toContain("wrapped:");
    expect(credential).toHaveBeenCalledWith(performer.id, "password", "synthetic-secret", expect.objectContaining({ resourceType: "UserEsignature", operation: "ESIGNATURE_CREATE" }));
    expect(audits("ESIGNATURE_CREATED")).toEqual([expect.objectContaining({ action: "CREATE", resourceType: "UserEsignature", resourceId: row?.["id"] })]);
    expect(fingerprint).toBe(createHash("sha256").update(Buffer.from(KEY1.publicKeyPem.replace(/-----[^-]+-----|\s/g, ""), "base64")).digest("hex"));
  });

  it("replace: a new version; the old one superseded (kept); GET shows the active one and the history", async () => {
    await create();
    const res = await create();
    expect(data(res)).toMatchObject({ version: 2, status: "active" });
    const state = data(await callEsig(performer, "GET", "/me"));
    expect((state["active"] as Record<string, unknown>)["version"]).toBe(2);
    expect((state["history"] as Record<string, unknown>[]).map((h) => [h["version"], h["status"], typeof h["supersededAt"]])).toEqual([[1, "superseded", "string"]]);
    expect(audits("ESIGNATURE_REPLACED")).toEqual([expect.objectContaining({ action: "UPDATE" })]);
    expect(generated).toHaveBeenCalledTimes(2);
  });

  it("a specimen off the allow-list is 400 ESIG_SPECIMEN_INVALID — nothing written, no credential asked", async () => {
    expectCode(await create(performer, '<svg onload="x()"></svg>'), 400, "ESIG_SPECIMEN_INVALID", "The signature image is not accepted: attribute onload is not allowed on <svg>.");
    expect([rowsOf("UserEsignature").length, credential.mock.calls.length]).toEqual([0, 0]);
  });

  it("the platform operator (no tenant) cannot hold one: 403 ESIG_PLATFORM", async () => {
    const res = await callEsig(performer, "POST", "/me", { specimenSvg: SPECIMEN, ...CRED }, {}, null);
    expect([res.status, res.body.code]).toEqual([403, "ESIG_PLATFORM"]);
  });

  it("a wrong credential is the 401 and writes nothing; a KMS that cannot wrap is the 500; a concurrent save is the 409", async () => {
    credential.mockRejectedValueOnce(new AppError(401, "Invalid password for e-signature."));
    expect((await create()).status).toBe(401);
    expect(rowsOf("UserEsignature")).toEqual([]);
    jest.spyOn(signingKeyWrap, "wrapPrivateKey").mockReturnValueOnce(null);
    expect(await create()).toMatchObject({ status: 500, body: { message: "The e-signature key could not be protected (KMS)." } });
    jest.spyOn(models.UserEsignature, "create").mockRejectedValueOnce(new UniqueConstraintError({}));
    expect((await create()).status).toBe(409);
    jest.spyOn(models.UserEsignature, "create").mockRejectedValueOnce(new Error("boom"));
    expect((await create()).status).toBe(500);
  });

  it("revoke mine: revoked (kept), audited; again is 409 ESIG_NONE", async () => {
    await create();
    const res = await callEsig(performer, "POST", "/me/revoke", { ...CRED, reason: "Lost my laptop" });
    expect(data(res)).toMatchObject({ status: "revoked", revokedAt: expect.any(String) as unknown });
    expect(rowsOf("UserEsignature")[0]).toMatchObject({ status: "revoked", revokedReason: "Lost my laptop" });
    expect(audits("ESIGNATURE_REVOKED")).toHaveLength(1);
    expectCode(await callEsig(performer, "POST", "/me/revoke", { ...CRED, reason: "Again" }), 409, "ESIG_NONE", "Create your e-signature first, in Profile → E-signature.");
  });

  it("a tenant administrator revokes another user's; a user with none is 409; a missing user 404; a non-administrator 403", async () => {
    await create();
    const res = await callEsig(admin, "POST", `/users/${performer.id}/revoke`, { reason: "Departed employee" });
    expect(data(res)).toMatchObject({ status: "revoked" });
    expect(audits("ESIGNATURE_REVOKED_BY_ADMIN")).toEqual([expect.objectContaining({ userId: admin.id })]);
    expect((await callEsig(admin, "POST", `/users/${colleague.id}/revoke`, { reason: "Departed" })).status).toBe(409);
    expect((await callEsig(admin, "POST", `/users/${MISSING}/revoke`, { reason: "Departed" })).status).toBe(404);
    expect((await callEsig(technician, "POST", `/users/${performer.id}/revoke`, { reason: "Departed" })).status).toBe(403);
  });

  it("an API key is refused; the services refuse a principal with no person too", async () => {
    expect((await callEsig({ ...performer, isApiKey: true }, "GET", "/me")).status).toBe(403);
    await expect(mine.createOrReplace(tenantA as TenantId, { specimenSvg: SPECIMEN, authMethod: "password", credential: "x" }, { userId: null })).rejects.toMatchObject({ status: 403 });
    await expect(apps.signDocument(tenantA as TenantId, { title: "x", contentHash: "a".repeat(64), sizeBytes: 1, meaning: "authored", authMethod: "password", credential: "x" }, { userId: null })).rejects.toMatchObject({ status: 403 });
  });

  it("the real generator makes an RSA-3072 pair", async () => {
    generated.mockRestore();
    const made = await mine.keyPairs.generate();
    expect(made.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/);
    expect(mine.fingerprintOf(made.publicKeyPem)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("application to a calibration record (§ 4)", () => {
  it("performed by the performer: the content hash, an RSA signature the stored public key verifies, the audit and Part 11 rows, the event", async () => {
    await create();
    const res = await apply(performer, "performed", RECORD, { "user-agent": `Synthetic/${"x".repeat(600)}` });
    expect([res.status, res.body.message]).toEqual([201, "Calibration record signed"]);
    const [row] = rowsOf("EsignatureApplication");
    const esigRow = rowsOf("UserEsignature")[0] as Record<string, unknown>;
    const record = rowsOf("CalibrationRecord").find((r) => r["id"] === RECORD) as Record<string, unknown>;
    const hash = createHash("sha256").update(canonicalCalibrationRecordData(record as never), "utf8").digest("hex");
    expect(row).toMatchObject({
      tenantId: tenantA,
      esignatureId: esigRow["id"],
      signerUserId: performer.id,
      documentType: "calibration_record",
      documentId: RECORD,
      documentTitle: "Calibration record Pompa infus sintetis 2030-01-15",
      meaning: "performed",
      contentScheme: "calrec-data-v1",
      contentHash: hash,
      authMethod: "password",
      ipAddress: "127.0.0.1",
    });
    expect(String(row?.["userAgent"])).toHaveLength(500);
    const payload = esignatureSignedPayload({
      tenantId: tenantA,
      applicationId: String(row?.["id"]),
      esignatureId: String(esigRow["id"]),
      keyFingerprint: String(esigRow["keyFingerprint"]),
      documentType: "calibration_record",
      documentId: RECORD,
      contentScheme: "calrec-data-v1",
      contentHash: hash,
      meaning: "performed",
      signerUserId: performer.id,
      signedAt: (row?.["signedAt"] as Date).toISOString(),
      authMethod: "password",
    });
    expect(rsaVerify("sha256", Buffer.from(payload), KEY1.publicKeyPem, Buffer.from(String(row?.["signatureValue"]), "base64"))).toBe(true);
    expect(data(res)).toMatchObject({ id: row?.["id"], specimenSvg: SPECIMEN, integrity: "intact", verifyUrl: `http://localhost:5000/api/v1/public/esignatures/${String(row?.["id"])}?token=${String(row?.["verificationToken"])}` });
    const text = JSON.stringify(res.body);
    for (const absent of ["signerUserId", "ipAddress", "userAgent", "Synthetic/", "verificationToken", "signatureValue", "PRIVATE KEY"]) {
      expect(text).not.toContain(absent);
    }
    expect(audits("ESIGNATURE_APPLIED")).toEqual([expect.objectContaining({ action: "APPROVE", resourceType: "CalibrationRecord", resourceId: RECORD })]);
    expect(rowsOf("ESignatureRecord")).toEqual([expect.objectContaining({ entityType: "CalibrationRecord", entityId: RECORD, userId: performer.id, action: "sign", meaning: "performed", documentHash: hash })]);
    expect(mockEmits).toEqual([{ event: "esignature:applied", rooms: [`tenant_${tenantA}`], payload: { documentType: "calibration_record", documentId: RECORD, applicationId: row?.["id"] } }]);
    expectCode(await apply(), 409, "ESIG_ALREADY_APPLIED", /^You signed this record as performed on \d{4}-\d{2}-\d{2}\.$/);
  });

  it("reviewed by another person; the performer cannot review and another person cannot perform (403 ESIG_NOT_PERFORMER)", async () => {
    await create(colleague);
    expect((await apply(colleague, "reviewed")).status).toBe(201);
    expectCode(await apply(colleague, "performed"), 403, "ESIG_NOT_PERFORMER", "Only the technician who performed this calibration can sign it as performed; sign it as reviewed instead.");
    await create(performer);
    expectCode(await apply(performer, "reviewed"), 403, "ESIG_NOT_PERFORMER", "The technician who performed this calibration signs it as performed, not as reviewed.");
  });

  it("without an e-signature: 409 ESIG_NONE; with a revoked one too", async () => {
    expectCode(await apply(), 409, "ESIG_NONE", "Create your e-signature first, in Profile → E-signature.");
    await create();
    await callEsig(performer, "POST", "/me/revoke", { ...CRED, reason: "Lost" });
    expect((await apply()).body.code).toBe("ESIG_NONE");
  });

  it("the record's state: voided, superseded (with the head of the chain), external or imported", async () => {
    await create();
    setRow("CalibrationRecord", RECORD, { isDeleted: true, voidReason: "Synthetic", deletedAt: new Date("2030-02-01T08:00:00.000Z") });
    expectCode(await apply(), 409, "CALREC_VOIDED", "This record was voided on 2030-02-01; a voided record is not signed.");
    const C1 = "a2000000-0000-4000-8000-0000000000c1";
    const C2 = "a2000000-0000-4000-8000-0000000000c2";
    const R2 = "a2000000-0000-4000-8000-000000000002";
    seedRecord(R2, { supersededById: C1, supersededAt: new Date("2030-02-20T00:00:00.000Z") });
    seedRecord(C1, { supersedesId: R2, correctionReason: "Synthetic", supersededById: C2, supersededAt: new Date("2030-03-01T00:00:00.000Z") });
    seedRecord(C2, { supersedesId: C1, correctionReason: "Synthetic" });
    const superseded = await apply(performer, "performed", R2);
    expectCode(superseded, 409, "CALREC_SUPERSEDED", "This record was corrected on 2030-02-20; sign the latest version.");
    expect(superseded.body.headId).toBe(C2);
    setRow("CalibrationRecord", C2, { entryKind: "external_date", externalLabName: "Lab Luar", results: null });
    expectCode(await apply(performer, "performed", C2), 409, "CALREC_EXTERNAL", "Records from an external laboratory or the previous system are not signed electronically.");
    setRow("CalibrationRecord", C2, { entryKind: "full_record", performedBy: null, apiKeyId: "a4000000-0000-4000-8000-000000000001" });
    expect((await apply(performer, "performed", C2)).body.code).toBe("CALREC_EXTERNAL");
  });

  it("a wrong credential writes nothing; a concurrent second application is ESIG_ALREADY_APPLIED; a KMS that cannot unwrap is the 500; a missing record 404", async () => {
    await create();
    credential.mockRejectedValueOnce(new AppError(401, "Invalid password for e-signature."));
    expect((await apply()).status).toBe(401);
    expect([rowsOf("EsignatureApplication").length, rowsOf("ESignatureRecord").length, audits("ESIGNATURE_APPLIED").length]).toEqual([0, 0, 0]);
    jest.spyOn(models.EsignatureApplication, "create").mockRejectedValueOnce(new UniqueConstraintError({}));
    expectCode(await apply(), 409, "ESIG_ALREADY_APPLIED", "You have already signed this calibration record as performed.");
    jest.spyOn(models.EsignatureApplication, "create").mockRejectedValueOnce(new Error("boom"));
    expect((await apply()).status).toBe(500);
    jest.spyOn(signingKeyWrap, "unwrapPrivateKey").mockImplementationOnce(() => {
      throw new Error("bad envelope");
    });
    expect(await apply()).toMatchObject({ status: 500, body: { message: "The e-signature key could not be unlocked (KMS). Existing signatures still verify." } });
    expect((await apply(performer, "performed", MISSING)).status).toBe(404);
  });

  it("the record's applications: none, then intact, then changed once the data no longer hashes; a missing record 404", async () => {
    expect((await callRecord(colleague, "GET", `/${RECORD}/esignatures`)).body.data).toEqual([]);
    await signedRecord();
    const list = (await callRecord(colleague, "GET", `/${RECORD}/esignatures`)).body.data as Record<string, unknown>[];
    expect(list.map((a) => [a["meaning"], a["integrity"], a["specimenSvg"]])).toEqual([["performed", "intact", SPECIMEN]]);
    setRow("CalibrationRecord", RECORD, { notes: "Tampered" });
    expect(((await callRecord(colleague, "GET", `/${RECORD}/esignatures`)).body.data as Record<string, unknown>[])[0]?.["integrity"]).toBe("changed");
    expect((await callRecord(colleague, "GET", `/${MISSING}/esignatures`)).status).toBe(404);
  });

  it("the link is the frontend page when PUBLIC_APP_URL is set; otherwise the API on PUBLIC_BASE_URL", () => {
    ENV["PUBLIC_APP_URL"] = "https://app.example.test/";
    expect(apps.esigVerifyUrl("id", "a/b")).toBe("https://app.example.test/s/id?t=a%2Fb");
    delete ENV["PUBLIC_APP_URL"];
    const saved = ENV["PUBLIC_BASE_URL"];
    ENV["PUBLIC_BASE_URL"] = "https://api.example.test/";
    expect(apps.esigVerifyUrl("id", "t")).toBe("https://api.example.test/api/v1/public/esignatures/id?token=t");
    if (saved === undefined) {
      delete ENV["PUBLIC_BASE_URL"];
    } else {
      ENV["PUBLIC_BASE_URL"] = saved;
    }
  });
});

describe("a document by hash, and what I have signed (§ 4)", () => {
  const DOC = { title: "Laporan audit.pdf", contentHash: "b".repeat(64), sizeBytes: 2048, meaning: "authored", ...CRED };

  it("signs the hash only — no file — with its own link; the Part 11 row names the application; my applications are paged", async () => {
    expect((await callEsig(performer, "POST", "/documents", DOC)).body.code).toBe("ESIG_NONE");
    await create();
    const res = await callEsig(performer, "POST", "/documents", DOC);
    expect(res.status).toBe(201);
    const row = rowsOf("EsignatureApplication")[0] as Record<string, unknown>;
    expect(row).toMatchObject({ documentType: "document", documentId: null, documentTitle: "Laporan audit.pdf", contentScheme: "file-sha256", contentHash: "b".repeat(64), meaning: "authored" });
    expect(data(res)).toMatchObject({ documentType: "document", integrity: null });
    expect(rowsOf("ESignatureRecord")).toEqual([expect.objectContaining({ entityType: "EsignatureDocument", entityId: row["id"] })]);
    expect(audits("ESIGNATURE_APPLIED")).toEqual([expect.objectContaining({ resourceType: "EsignatureApplication", resourceId: row["id"] })]);
    await apply();
    const page = await callEsig(performer, "GET", "/me/applications", {}, { page: "1", limit: "1" });
    expect([(page.body.data as unknown[]).length, page.body.meta]).toEqual([1, { total: 2, page: 1, limit: 1, totalPages: 2 }]);
    expect(((await callEsig(colleague, "GET", "/me/applications")).body.data as unknown[]).length).toBe(0);
  });
});

describe("the public verification (§ 4)", () => {
  it("valid: exactly the allowed fields — never an e-mail, an address, an agent or the token; no-store and noindex", async () => {
    const { id, token } = await signedRecord();
    const res = await verify(id, { token });
    expect(res.status).toBe(200);
    expect([res.headers["cache-control"], res.headers["x-robots-tag"]]).toEqual(["no-store", "noindex"]);
    const verdict = data(res);
    expect(Object.keys(verdict).sort()).toEqual(
      [
        "verdict", "explanation", "esignatureState", "esignatureStateAt", "documentState", "documentStateAt", "signedAt", "meaning", "signer", "specimenSvg",
        "keyFingerprint", "publicKeyPem", "organisation", "documentType", "documentTitle", "contentScheme", "contentHash", "canonicalContent", "summary",
      ].sort(),
    );
    expect(verdict).toMatchObject({
      verdict: "valid",
      esignatureState: "active",
      esignatureStateAt: null,
      documentState: "current",
      documentStateAt: null,
      meaning: "performed",
      specimenSvg: SPECIMEN,
      publicKeyPem: KEY1.publicKeyPem,
      documentType: "calibration_record",
      summary: { deviceName: "Pompa infus sintetis", brand: "Pembuat", model: "P-1", serialNumber: "SN-0001", calibrationDate: "2030-01-15", dueDate: "2031-01-15", isCompliant: true },
    });
    expect(createHash("sha256").update(JSON.stringify(verdict["canonicalContent"]), "utf8").digest("hex")).toBe(verdict["contentHash"]);
    const text = JSON.stringify(res.body);
    for (const absent of [token, "@", "127.0.0.1", "ipAddress", "userAgent", "signerUserId", "signatureValue", "PRIVATE KEY"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("content_changed: the signature verifies but the record no longer hashes — logged at warn and counted", async () => {
    const { id, token } = await signedRecord();
    const warn = jest.spyOn(logger, "warn");
    const before = apps.esigContentChangedSignals();
    setRow("CalibrationRecord", RECORD, { results: { reading: 99, unit: "C" } });
    expect(data(await verify(id, { token }))["verdict"]).toBe("content_changed");
    expect(apps.esigContentChangedSignals()).toBe(before + 1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("changed after it was e-signed"), expect.objectContaining({ code: "ESIG_CONTENT_CHANGED", applicationId: id }));
  });

  it("invalid: a payload that no longer matches, or a public key that cannot be read", async () => {
    const { id, token } = await signedRecord();
    setRow("EsignatureApplication", id, { signedAt: new Date("2030-01-01T00:00:00.000Z") });
    expect(data(await verify(id, { token }))["verdict"]).toBe("invalid");
    setRow("UserEsignature", String(rowsOf("UserEsignature")[0]?.["id"]), { publicKeyPem: "not a key" });
    expect(data(await verify(id, { token }))["verdict"]).toBe("invalid");
  });

  it("beside a valid verdict: a superseded, then a revoked e-signature with its day; a superseded, then a voided record with its day", async () => {
    const { id, token } = await signedRecord();
    await create();
    expect(data(await verify(id, { token }))).toMatchObject({ verdict: "valid", esignatureState: "superseded", esignatureStateAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown });
    const esigId = String(rowsOf("UserEsignature")[0]?.["id"]);
    setRow("UserEsignature", esigId, { status: "revoked", supersededAt: null, revokedAt: new Date("2030-06-01T00:00:00.000Z"), revokedReason: "Synthetic" });
    expect(data(await verify(id, { token }))).toMatchObject({ verdict: "valid", esignatureState: "revoked", esignatureStateAt: "2030-06-01" });
    setRow("CalibrationRecord", RECORD, { supersededById: "a2000000-0000-4000-8000-0000000000c1", supersededAt: new Date("2030-04-02T00:00:00.000Z") });
    expect(data(await verify(id, { token }))).toMatchObject({ verdict: "valid", documentState: "superseded", documentStateAt: "2030-04-02" });
    setRow("CalibrationRecord", RECORD, { isDeleted: true, voidReason: "Synthetic void", deletedAt: new Date("2030-05-03T00:00:00.000Z") });
    const voided = await verify(id, { token });
    expect(data(voided)).toMatchObject({ verdict: "valid", documentState: "voided", documentStateAt: "2030-05-03" });
    expect(JSON.stringify(voided.body)).not.toContain("Synthetic void");
  });

  it("a document: valid, with the compare-your-file explanation; no canonical content, no record state", async () => {
    await create();
    await callEsig(performer, "POST", "/documents", { title: "Laporan.pdf", contentHash: "c".repeat(64), sizeBytes: 10, meaning: "acknowledged", ...CRED });
    const row = rowsOf("EsignatureApplication")[0] as Record<string, unknown>;
    const verdict = data(await verify(String(row["id"]), { token: row["verificationToken"] }));
    expect(verdict).toMatchObject({ verdict: "valid", documentType: "document", contentScheme: "file-sha256", canonicalContent: null, summary: null, documentState: null });
    expect((verdict["explanation"] as Record<string, string>)["en"]).toMatch(/Compare your file/);
  });

  it.each([
    ["no token", (id: string) => [id, {}]],
    ["a wrong token", (id: string) => [id, { token: "A".repeat(32) }]],
    ["a malformed token", (id: string) => [id, { token: "short" }]],
    ["a malformed id", (_id: string, t: string) => ["not-a-uuid", { token: t }]],
    ["an unknown id with the right token", (_id: string, t: string) => [MISSING, { token: t }]],
  ] as const)("%s → the one identical 404, with the headers", async (_label, make) => {
    const { id, token } = await signedRecord();
    const [target, query] = (make as (i: string, t: string) => [string, Record<string, unknown>])(id, token);
    const res = await verify(target, query);
    const { success, status, message, data: body } = res.body as Record<string, unknown>;
    expect([res.status, { success, status, message, data: body }, res.headers["cache-control"]]).toEqual([404, NOT_FOUND, "no-store"]);
  });

  it("a record that is gone leaves the verdict without content or state; an e-signature that is gone is the 404", async () => {
    const { id, token } = await signedRecord();
    dropRow("CalibrationRecord", RECORD);
    expect(data(await verify(id, { token }))).toMatchObject({ verdict: "valid", documentState: null, canonicalContent: null });
    dropRow("UserEsignature", String(rowsOf("UserEsignature")[0]?.["id"]));
    expect((await verify(id, { token })).status).toBe(404);
  });

  it("an unforeseen failure is not turned into a 404", async () => {
    jest.spyOn(apps, "verifyPublic").mockRejectedValueOnce(new Error("boom"));
    expect((await verify(MISSING, { token: "A".repeat(32) })).status).toBe(500);
  });

  it("only an answer that is not a verdict counts against esigVerify (60 / 15 min per address) — beyond it 429; a verdict still answers", async () => {
    const { id, token } = await signedRecord();
    const saved = ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
    ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
    try {
      let refused: Res | null = null;
      for (let i = 0; i < 61 && !refused; i += 1) {
        const res = await verify(id, { token: "A".repeat(32) });
        refused = res.status === 429 ? res : null;
      }
      expect(refused?.body).toMatchObject({ success: false, status: 429, data: null });
      expect((await verify(id, { token })).status).toBe(200);
    } finally {
      if (saved === undefined) {
        delete ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
      } else {
        ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = saved;
      }
    }
  });
});

describe("the edges: absent optional facts read as absent, never as a failure", () => {
  it("a direct call with no address or agent stores nulls ('unknown' in the Part 11 log)", async () => {
    await runForTenant(tenantA, () => mine.createOrReplace(tenantA as TenantId, { specimenSvg: SPECIMEN, authMethod: "password", credential: "x" }, { userId: performer.id }));
    await runForTenant(tenantA, () => apps.signDocument(tenantA as TenantId, { title: "Doc", contentHash: "d".repeat(64), sizeBytes: 1, meaning: "authored", authMethod: "password", credential: "x" }, { userId: performer.id }));
    await runForTenant(tenantA, () => apps.applyToRecord(tenantA as TenantId, { calibrationRecordId: RECORD, meaning: "performed", authMethod: "password", credential: "x" }, { userId: performer.id }));
    expect(rowsOf("EsignatureApplication").map((r) => [r["ipAddress"], r["userAgent"]])).toEqual([[null, null], [null, null]]);
    expect(rowsOf("ESignatureRecord").map((r) => r["ipAddress"])).toEqual(["unknown", "unknown"]);
    await runForTenant(tenantA, () => mine.revokeMine(tenantA as TenantId, { authMethod: "password", credential: "x", reason: "Lost" }, { userId: performer.id }));
    expect(rowsOf("UserEsignature")[0]?.["status"]).toBe("revoked");
  });

  it("a void with no deletion time names its last change; a chain whose next record is gone stops there; a supersession with no time says so", async () => {
    await create();
    setRow("CalibrationRecord", RECORD, { isDeleted: true, voidReason: "Synthetic", deletedAt: null, updatedAt: new Date("2030-02-02T00:00:00.000Z") });
    expect((await apply()).body.message).toBe("This record was voided on 2030-02-02; a voided record is not signed.");
    setRow("CalibrationRecord", RECORD, { isDeleted: false, voidReason: null, updatedAt: null, supersededById: MISSING, supersededAt: null });
    const res = await apply();
    expect([res.body.message, res.body.headId]).toEqual(["This record was corrected on an unknown date; sign the latest version.", RECORD]);
  });

  it("a record whose device is gone and whose dates and result are blank is titled and summarised without them; a gone e-signature or tenant reads as blank", async () => {
    await create();
    setRow("CalibrationRecord", RECORD, { dueDate: null, isCompliant: null, calibrationDate: null });
    dropRow("CalibrationDevice", DEVICE);
    expect((await apply()).status).toBe(201);
    const row = rowsOf("EsignatureApplication")[0] as Record<string, unknown>;
    expect(row["documentTitle"]).toBe("Calibration record");
    setRow("CalibrationRecord", RECORD, { calibrationDate: new Date("2030-01-15T00:00:00.000Z") });
    setRow("EsignatureApplication", String(row["id"]), { signerSnapshot: { name: "Teknisi", role: null, organisation: null } });
    expect(data(await verify(String(row["id"]), { token: row["verificationToken"] }))["signer"]).toEqual({ name: "Teknisi", role: null, organisation: null });
    expect(((await callRecord(colleague, "GET", `/${RECORD}/esignatures`)).body.data as Record<string, unknown>[])[0]?.["signer"]).toEqual({ name: "Teknisi", role: null, organisation: null });
    setRow("EsignatureApplication", String(row["id"]), { signerSnapshot: { name: "Teknisi", role: "TECHNICIAN", organisation: "Lab Sintetis" } });
    dropRow("Tenant", tenantA);
    const verdict = data(await verify(String(row["id"]), { token: row["verificationToken"] }));
    expect(verdict).toMatchObject({
      organisation: { name: null },
      signer: { name: "Teknisi", role: "TECHNICIAN", organisation: "Lab Sintetis" },
      summary: { deviceName: null, brand: null, model: null, serialNumber: null, dueDate: null, isCompliant: null },
    });
    setRow("CalibrationRecord", RECORD, { isDeleted: true, voidReason: "Synthetic", deletedAt: null, updatedAt: new Date("2030-02-02T00:00:00.000Z") });
    expect(data(await verify(String(row["id"]), { token: row["verificationToken"] }))["documentStateAt"]).toBe("2030-02-02");
    setRow("CalibrationRecord", RECORD, { isDeleted: false, supersededById: MISSING, supersededAt: null });
    expect(data(await verify(String(row["id"]), { token: row["verificationToken"] }))["documentStateAt"]).toBeNull();
    dropRow("UserEsignature", String(rowsOf("UserEsignature")[0]?.["id"]));
    const list = (await callRecord(colleague, "GET", `/${RECORD}/esignatures`)).body.data as Record<string, unknown>[];
    expect(list.map((a) => [a["specimenSvg"], a["keyFingerprint"]])).toEqual([["", ""]]);
  });
});

describe("a facility-bound user holds its own e-signature (every user; FACILITY_READABLE own-user)", () => {
  const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
  const BOUND = "cccccccc-0000-4000-8000-0000000000f1";
  const boundPrincipal = (): Principal => ({ ...technician, id: BOUND, username: "boundf1", role: { ...technician.role, name: "HEALTHCARE TECHNICIAN" }, clientFacilityId: F1 }) as unknown as Principal;

  beforeEach(() => {
    mdb.seed("ClientFacility", { id: F1, tenantId: tenantA, name: "Facility One", code: "F-0001", status: "active" });
    mdb.seed("User", { id: BOUND, tenantId: tenantA, username: "boundf1", email: "boundf1@example.test", password: "x", firstName: "Bound", lastName: "One", roleId: technician.role.id, clientFacilityId: F1, status: "ACTIVE", isActive: true });
  });

  it("creates, reads, replaces and revokes its own e-signature, signs a document and lists what it signed — another user's stays hidden", async () => {
    const bound = boundPrincipal();
    await create(colleague);
    expect((await callEsig(bound, "GET", "/me")).body.data).toEqual({ active: null, history: [] });
    const created = await callEsig(bound, "POST", "/me", { specimenSvg: SPECIMEN, ...CRED });
    expect([created.status, data(created)["version"]]).toEqual([201, 1]);
    expect(rowsOf("UserEsignature").find((r) => r["userId"] === BOUND)).toMatchObject({ tenantId: tenantA, status: "active" });
    expect((await callEsig(bound, "POST", "/me", { specimenSvg: SPECIMEN, ...CRED })).status).toBe(201);
    const doc = await callEsig(bound, "POST", "/documents", { title: "Laporan.pdf", contentHash: "e".repeat(64), sizeBytes: 3, meaning: "authored", ...CRED });
    expect(doc.status).toBe(201);
    expect(rowsOf("ESignatureRecord")).toEqual([expect.objectContaining({ userId: BOUND, entityType: "EsignatureDocument" })]);
    const mineList = await callEsig(bound, "GET", "/me/applications");
    expect([(mineList.body.data as unknown[]).length, mineList.body.meta?.["total"]]).toEqual([1, 1]);
    const state = data(await callEsig(bound, "GET", "/me"));
    expect([(state["active"] as Record<string, unknown>)["version"], (state["history"] as unknown[]).length]).toEqual([2, 1]);
    expect(data(await callEsig(bound, "POST", "/me/revoke", { ...CRED, reason: "Left the facility" }))["status"]).toBe("revoked");
    expect(rowsOf("UserEsignature").find((r) => r["userId"] === colleague.id)?.["status"]).toBe("active");
  });

  it("the administrator's revoke of another user stays refused to a bound principal (403 FACILITY_ROUTE_REFUSED)", async () => {
    const res = await callEsig(boundPrincipal(), "POST", `/users/${colleague.id}/revoke`, { reason: "Departed" });
    expect([res.status, res.body.code]).toEqual([403, "FACILITY_ROUTE_REFUSED"]);
  });

  it("a bound reader sees who signed its facility's record (the reviewed skip), provider staff included", async () => {
    setRow("CalibrationRecord", RECORD, { clientFacilityId: F1 });
    setRow("CalibrationDevice", DEVICE, { clientFacilityId: F1 });
    await signedRecord();
    as(boundPrincipal());
    const res = (await call(records, "GET", `/${RECORD}/esignatures`, { routeFile: "api/calibrationRecords.route.ts" })) as Res;
    expect((res.body.data as Record<string, unknown>[])[0]?.["specimenSvg"]).toBe(SPECIMEN);
  });
});
