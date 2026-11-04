/**
 * P21-15 (ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 2 – § 4) — the personal
 * e-signature contract: the canonical forms pinned by GOLDEN text and hash (a change is a new scheme,
 * never an edit), the specimen allow-list, the canonical-pairs check the browser runs, the strict
 * schemas. Synthetic values only.
 */
import { createHash } from "node:crypto";
import {
  CALREC_DATA_FIELDS,
  ESIG_AUTH_METHODS,
  ESIG_CODES,
  ESIG_CONTENT_SCHEMES,
  ESIG_DOCUMENT_STATES,
  ESIG_DOCUMENT_TYPES,
  ESIG_MEANINGS,
  ESIG_STATUSES,
  ESIG_VERDICTS,
  ESIG_VERIFY_TOKEN,
  CERT_DATA_FIELDS,
  applyCertificateEsignature,
  applyCertificateEsignatureBody,
  applyRecordEsignature,
  applyRecordEsignatureBody,
  canonicalCertificateData,
  certificateDataPairs,
  certificateEsignatureMark,
  certificateEsignaturesParams,
  calibrationRecordDataPairs,
  canonicalCalibrationRecordData,
  canonicalJsonOfPairs,
  createMyEsignature,
  esignatureApplicationView,
  esignatureSignedPayload,
  myApplicationsQuery,
  myEsignatureState,
  publicEsignatureQuery,
  publicEsignatureVerdict,
  recordEsignaturesParams,
  revokeMyEsignature,
  revokeUserEsignature,
  revokeUserEsignatureBody,
  signDocument,
  specimenProblem,
} from "@callibrator/contracts/esignatures";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const TENANT = "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f";
const RECORD = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const DEVICE = "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const FACILITY = "2e3d4c5b-6a7f-4b8c-9d0e-1f2a3b4c5d6e";
const USER = "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f";
const ESIG = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const APP = "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a";

const FULL = {
  tenantId: TENANT,
  id: RECORD,
  deviceId: DEVICE,
  clientFacilityId: FACILITY,
  calibrationDate: new Date("2030-01-15T00:00:00.000Z"),
  dueDate: new Date("2031-01-15T00:00:00.000Z"),
  standard: "ISO 17025",
  results: { unit: "C", reading: 37.1, points: [{ set: 40, got: 39.9 }, { got: 30.1, set: 30 }] },
  measurementUncertainty: 0.1,
  isCompliant: true,
  entryKind: "full_record",
  performedBy: USER,
  calibrationVendorId: null,
  externalLabName: null,
  notes: "Dalam toleransi",
};

const GOLDEN_FULL =
  `[["schemeVersion","calrec-data-v1"],["tenantId","${TENANT}"],["recordId","${RECORD}"],["deviceId","${DEVICE}"],` +
  `["clientFacilityId","${FACILITY}"],["calibrationDate","2030-01-15"],["dueDate","2031-01-15"],["standard","ISO 17025"],` +
  `["results","{\\"points\\":[{\\"got\\":39.9,\\"set\\":40},{\\"got\\":30.1,\\"set\\":30}],\\"reading\\":37.1,\\"unit\\":\\"C\\"}"],` +
  `["measurementUncertainty","0.1"],["isCompliant","true"],["entryKind","full_record"],["performedBy","${USER}"],` +
  `["calibrationVendorId",""],["externalLabName",""],["notes","Dalam toleransi"]]`;
const GOLDEN_FULL_HASH = "56e69d620f618fec1190787ceaed5496af6ae3f7871d87a59c257a8cabc76075";
const GOLDEN_CERT_HASH = "1f8b29e89a4c9a0584a005e576b99d5a7776cf754c4088fd5ab2aa12009a5017";

const SPECIMEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M10 80 C 40 10, 65 10, 95 80" fill="none" stroke="#111" stroke-width="2"/></svg>';

describe("@callibrator/contracts/esignatures — values", () => {
  it("names the schemes, types, meanings, methods, statuses, verdicts, states, codes and the token shape", () => {
    expect([...ESIG_CONTENT_SCHEMES]).toEqual(["calrec-data-v1", "cert-data-v1", "file-sha256"]);
    expect([...ESIG_DOCUMENT_TYPES]).toEqual(["calibration_record", "certificate", "document"]);
    expect([...ESIG_MEANINGS]).toEqual(["performed", "reviewed", "approved", "authored", "acknowledged"]);
    expect([...ESIG_AUTH_METHODS]).toEqual(["password", "mfa"]);
    expect([...ESIG_STATUSES]).toEqual(["active", "superseded", "revoked"]);
    expect([...ESIG_VERDICTS]).toEqual(["valid", "content_changed", "invalid"]);
    expect([...ESIG_DOCUMENT_STATES]).toEqual(["current", "superseded", "voided", "revoked"]);
    expect(ESIG_CODES).toMatchObject({ platform: "ESIG_PLATFORM", none: "ESIG_NONE", notPerformer: "ESIG_NOT_PERFORMER", alreadyApplied: "ESIG_ALREADY_APPLIED" });
    expect([ESIG_VERIFY_TOKEN.test("A".repeat(32)), ESIG_VERIFY_TOKEN.test("A".repeat(31)), ESIG_VERIFY_TOKEN.test(`${"A".repeat(31)}+`)]).toEqual([true, false, false]);
  });
});

describe("the specimen allow-list (§ 2.1)", () => {
  it("accepts paths, shapes, groups and a PNG/JPEG data-URI image; self-closing and paired tags", () => {
    expect(specimenProblem(SPECIMEN)).toBeNull();
    expect(specimenProblem(`<svg viewBox="0 0 10 10"><g stroke="#000"><polyline points="1,1 2,2"></polyline><line x1="0" y1="0" x2="1" y2="1"/><circle cx="1" cy="1" r="1"/><ellipse cx="1" cy="1" rx="1" ry="1"/><rect x="0" y="0" width="1" height="1"/><polygon points="1,1 2,2 3,1"/></g></svg>`)).toBeNull();
    expect(specimenProblem(`<svg viewBox="0 0 10 10"><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>`)).toBeNull();
  });

  it.each([
    ["a script", '<svg><script>alert(1)</script></svg>', "element <script> is not allowed"],
    ["an event handler", '<svg onload="alert(1)"></svg>', "attribute onload is not allowed on <svg>"],
    ["an external image", '<svg><image href="https://x.test/a.png"/></svg>', "an image must be a PNG or JPEG data URI"],
    ["an SVG data image", '<svg><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>', "an image must be a PNG or JPEG data URI"],
    ["a url() in a value", '<svg><path d="M0 0" fill="url(#a)"/></svg>', "attribute fill has a value that is not allowed"],
    ["an entity", '<svg><path d="M0 0" fill="&#106;"/></svg>', "attribute fill has a value that is not allowed"],
    ["text", "<svg>hello</svg>", "text content is not allowed"],
    ["a comment", "<svg><!-- x --></svg>", "not an allowed tag"],
    ["a foreignObject", "<svg><foreignObject></foreignObject></svg>", "element <foreignObject> is not allowed"],
    ["two roots", "<svg></svg><svg></svg>", "the root must be one <svg>"],
    ["a non-svg root", "<path d=\"M0 0\"/>", "the root must be one <svg>"],
    ["a nested svg", "<svg><svg></svg></svg>", "a nested <svg> is not allowed"],
    ["unbalanced tags", "<svg><g></svg>", "unbalanced tags"],
    ["an unclosed root", "<svg><g></g>", "the root must be one complete <svg>"],
    ["nothing", "   ", "the root must be one complete <svg>"],
  ])("refuses %s", (_label, svg, reason) => {
    expect(specimenProblem(svg)).toBe(reason);
  });

  it("counts the size in UTF-8 bytes (one to four per character)", () => {
    expect(specimenProblem(`<svg version="aé€😀"></svg>`)).toBeNull();
    expect(specimenProblem(`<svg version="${"😀".repeat(16384)}"></svg>`)).toBe("too large");
  });

  it("refuses a paths-only specimen over 64 KB and anything over 256 KB", () => {
    const path = `<path d="${"M0 0 ".repeat(14000)}"/>`;
    expect(specimenProblem(`<svg>${path}</svg>`)).toBe("too large");
    const image = `<image href="data:image/png;base64,${"A".repeat(100000)}"/>`;
    expect(specimenProblem(`<svg>${image}<path d="${"M0 0 ".repeat(1000)}"/></svg>`)).toBeNull();
    expect(specimenProblem(`<svg><image href="data:image/png;base64,${"A".repeat(270000)}"/></svg>`)).toBe("too large");
  });
});

describe("the canonical calibration-record data (calrec-data-v1) — GOLDEN", () => {
  it("a full record: the fixed order, every value a string, results' keys sorted at every depth; the golden hash", () => {
    const json = canonicalCalibrationRecordData(FULL);
    expect(json).toBe(GOLDEN_FULL);
    expect(sha256(json)).toBe(GOLDEN_FULL_HASH);
    expect(calibrationRecordDataPairs(FULL).map(([name]) => name)).toEqual([...CALREC_DATA_FIELDS]);
  });

  it("nulls and absent members are written as \"\"; a false and a zero are kept; a day given as text keeps its first ten characters", () => {
    const sparse = canonicalCalibrationRecordData({ tenantId: TENANT, id: RECORD, deviceId: DEVICE, calibrationDate: "2030-02-01T00:00:00.000Z", isCompliant: false, measurementUncertainty: 0 });
    expect(sparse).toBe(
      `[["schemeVersion","calrec-data-v1"],["tenantId","${TENANT}"],["recordId","${RECORD}"],["deviceId","${DEVICE}"],` +
        `["clientFacilityId",""],["calibrationDate","2030-02-01"],["dueDate",""],["standard",""],["results",""],` +
        `["measurementUncertainty","0"],["isCompliant","false"],["entryKind",""],["performedBy",""],` +
        `["calibrationVendorId",""],["externalLabName",""],["notes",""]]`,
    );
    const nulls = calibrationRecordDataPairs({ ...FULL, results: null, measurementUncertainty: null, isCompliant: null, dueDate: null, calibrationDate: new Date("nope") });
    expect(Object.fromEntries(nulls)).toMatchObject({ results: "", measurementUncertainty: "", isCompliant: "", dueDate: "", calibrationDate: "" });
    expect(calibrationRecordDataPairs({ ...FULL, calibrationDate: null }).find(([n]) => n === "calibrationDate")?.[1]).toBe("");
  });

  it("canonicalJsonOfPairs: the served pairs as the canonical JSON, or null when they are not exactly canonical for the scheme", () => {
    const pairs = calibrationRecordDataPairs(FULL);
    expect(canonicalJsonOfPairs("calrec-data-v1", JSON.parse(JSON.stringify(pairs)))).toBe(GOLDEN_FULL);
    expect(canonicalJsonOfPairs("file-sha256", pairs)).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", null)).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", pairs.slice(1))).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", [pairs[1], pairs[0], ...pairs.slice(2)])).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", pairs.map(([n, v], i) => (i === 3 ? [n, 7] : [n, v])))).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", pairs.map(([n, v], i) => (i === 3 ? [n, v, "x"] : [n, v])))).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", pairs.map(([n, v], i) => (i === 3 ? "x" : [n, v])))).toBeNull();
    expect(canonicalJsonOfPairs("calrec-data-v1", pairs.map(([n, v], i) => (i === 0 ? [n, "calrec-data-v2"] : [n, v])))).toBeNull();
  });
});

describe("the canonical certificate data (cert-data-v1) — GOLDEN", () => {
  const CERT = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
  const FULL_CERT = {
    tenantId: TENANT,
    id: CERT,
    certificateNumber: "HOSP-20300115-0001",
    type: "calibration",
    calibrationRecordId: RECORD,
    deviceId: DEVICE,
    issueDate: new Date("2030-01-16T00:00:00.000Z"),
    validUntil: new Date("2031-01-15T00:00:00.000Z"),
    standard: "ISO 17025",
    summary: "Dalam toleransi",
    conditions: "23 °C",
    notes: null,
    calibratedBy: USER,
    // Flow state never enters the form:
    status: "signed",
    digitalSignature: "x",
    signedAt: new Date(),
  };
  const GOLDEN_CERT =
    `[["schemeVersion","cert-data-v1"],["tenantId","${TENANT}"],["certificateId","${CERT}"],["certificateNumber","HOSP-20300115-0001"],` +
    `["type","calibration"],["calibrationRecordId","${RECORD}"],["deviceId","${DEVICE}"],["issueDate","2030-01-16"],["validUntil","2031-01-15"],` +
    `["standard","ISO 17025"],["summary","Dalam toleransi"],["conditions","23 °C"],["notes",""],["calibratedBy","${USER}"]]`;

  it("the fixed order of what the certificate says; never its status, signature or signing time", () => {
    expect(canonicalCertificateData(FULL_CERT)).toBe(GOLDEN_CERT);
    expect(sha256(canonicalCertificateData(FULL_CERT))).toBe(GOLDEN_CERT_HASH);
    expect(certificateDataPairs(FULL_CERT).map(([n]) => n)).toEqual([...CERT_DATA_FIELDS]);
    const unsigned = { ...FULL_CERT, status: "approved", digitalSignature: "", signedAt: new Date(0) };
    expect(canonicalCertificateData(unsigned)).toBe(GOLDEN_CERT);
    const sparse = certificateDataPairs({ tenantId: TENANT, id: CERT, certificateNumber: "N", deviceId: DEVICE });
    expect(Object.fromEntries(sparse)).toMatchObject({ type: "", calibrationRecordId: "", issueDate: "", validUntil: "", standard: "", summary: "", conditions: "", notes: "", calibratedBy: "" });
    expect(canonicalJsonOfPairs("cert-data-v1", JSON.parse(GOLDEN_CERT))).toBe(GOLDEN_CERT);
  });
});

describe("the signed payload (esig-app-v1-rsa-sha256) — GOLDEN", () => {
  it("names every bound member in order; a document's absent id is written as \"\"", () => {
    const base = {
      tenantId: TENANT,
      applicationId: APP,
      esignatureId: ESIG,
      keyFingerprint: "f".repeat(64),
      documentType: "calibration_record",
      documentId: RECORD,
      contentScheme: "calrec-data-v1",
      contentHash: GOLDEN_FULL_HASH,
      meaning: "performed",
      signerUserId: USER,
      signedAt: "2030-01-15T09:30:00.123Z",
      authMethod: "password",
    };
    expect(esignatureSignedPayload(base)).toBe(
      `[["scheme","esig-app-v1-rsa-sha256"],["tenantId","${TENANT}"],["applicationId","${APP}"],["esignatureId","${ESIG}"],` +
        `["keyFingerprint","${"f".repeat(64)}"],["documentType","calibration_record"],["documentId","${RECORD}"],["contentScheme","calrec-data-v1"],` +
        `["contentHash","${GOLDEN_FULL_HASH}"],["meaning","performed"],["signerUserId","${USER}"],["signedAt","2030-01-15T09:30:00.123Z"],["authMethod","password"]]`,
    );
    expect(esignatureSignedPayload({ ...base, documentType: "document", documentId: null })).toContain('["documentId",""]');
  });
});

describe("the schemas", () => {
  const cred = { authMethod: "password", credential: "synthetic-secret" };

  it("my e-signature: create with a specimen and a credential; revoke with a reason; an admin revoke names the user", () => {
    expect(createMyEsignature.parse({ specimenSvg: SPECIMEN, ...cred })).toEqual({ specimenSvg: SPECIMEN, ...cred });
    expect(createMyEsignature.safeParse({ specimenSvg: SPECIMEN, ...cred, userId: USER }).success).toBe(false);
    expect(createMyEsignature.safeParse({ specimenSvg: "", ...cred }).success).toBe(false);
    expect(revokeMyEsignature.parse({ ...cred, reason: " Left the lab " })).toEqual({ ...cred, reason: "Left the lab" });
    expect(revokeMyEsignature.safeParse({ ...cred, reason: "x" }).success).toBe(false);
    expect(revokeUserEsignature.parse({ userId: USER, reason: "Departed" })).toEqual({ userId: USER, reason: "Departed" });
    expect(revokeUserEsignatureBody.safeParse({ userId: USER, reason: "Departed" }).success).toBe(false);
  });

  it("apply to a record: `performed` or `reviewed` only; strict", () => {
    expect(applyRecordEsignature.parse({ calibrationRecordId: RECORD, meaning: "reviewed", ...cred })).toMatchObject({ meaning: "reviewed" });
    expect(applyRecordEsignatureBody.safeParse({ meaning: "approved", ...cred }).success).toBe(false);
    expect(applyRecordEsignatureBody.safeParse({ meaning: "performed", ...cred, credential: "" }).success).toBe(false);
    expect(applyRecordEsignatureBody.safeParse({ meaning: "performed", ...cred, tenantId: TENANT }).success).toBe(false);
    expect(recordEsignaturesParams.safeParse({ calibrationRecordId: "nope" }).success).toBe(false);
  });

  it("apply to a certificate: `performed` or `approved` only; strict; the mark is strict too", () => {
    const CERT = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
    expect(applyCertificateEsignature.parse({ certificateId: CERT, meaning: "approved", ...cred })).toMatchObject({ meaning: "approved" });
    expect(applyCertificateEsignatureBody.safeParse({ meaning: "reviewed", ...cred }).success).toBe(false);
    expect(certificateEsignaturesParams.safeParse({ certificateId: "nope" }).success).toBe(false);
    const mark = { meaning: "approved", name: "A", role: null, organisation: null, signedAt: "2030-01-15T09:30:00.123Z", specimenSvg: SPECIMEN, verifyUrl: "https://x.test/s/1?t=y" };
    expect(certificateEsignatureMark.parse(mark)).toEqual(mark);
    expect(certificateEsignatureMark.safeParse({ ...mark, signerUserId: USER }).success).toBe(false);
  });

  it("a document by hash: a lower-case SHA-256 hex, a title, a size — never the file", () => {
    const doc = { title: " Laporan.pdf ", contentHash: "a".repeat(64), sizeBytes: 1024, meaning: "authored", ...cred };
    expect(signDocument.parse(doc)).toMatchObject({ title: "Laporan.pdf" });
    expect(signDocument.safeParse({ ...doc, contentHash: "A".repeat(64) }).success).toBe(false);
    expect(signDocument.safeParse({ ...doc, sizeBytes: -1 }).success).toBe(false);
    expect(signDocument.safeParse({ ...doc, file: "x" }).success).toBe(false);
    expect(myApplicationsQuery.parse({})).toEqual({ page: 1, limit: 20 });
    expect(myApplicationsQuery.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("the public query is LOOSE on shape, bounded in length", () => {
    expect(publicEsignatureQuery.parse({ applicationId: "not-a-uuid" })).toEqual({ applicationId: "not-a-uuid" });
    expect(publicEsignatureQuery.safeParse({ applicationId: "x".repeat(65) }).success).toBe(false);
    expect(publicEsignatureQuery.safeParse({ applicationId: APP, token: "x".repeat(129) }).success).toBe(false);
  });

  it("the answers are strict: never a private key, an id of the signer, an address, an agent or the token", () => {
    const mine = { id: ESIG, version: 1, status: "active", specimenSvg: SPECIMEN, keyFingerprint: "f".repeat(64), createdAt: "2030-01-15T09:30:00.123Z", supersededAt: null, revokedAt: null };
    expect(myEsignatureState.parse({ active: mine, history: [] })).toMatchObject({ active: { version: 1 } });
    expect(myEsignatureState.safeParse({ active: { ...mine, privateKeyEnc: "x" }, history: [] }).success).toBe(false);
    const view = {
      id: APP,
      documentType: "calibration_record",
      documentId: RECORD,
      documentTitle: "Calibration record",
      meaning: "performed",
      signer: { name: "Teknisi", role: null, organisation: null },
      specimenSvg: SPECIMEN,
      keyFingerprint: "f".repeat(64),
      contentScheme: "calrec-data-v1",
      contentHash: GOLDEN_FULL_HASH,
      authMethod: "password",
      signedAt: "2030-01-15T09:30:00.123Z",
      verifyUrl: "https://x.test/s/1?t=y",
      integrity: "intact",
    };
    expect(esignatureApplicationView.parse(view)).toEqual(view);
    expect(esignatureApplicationView.safeParse({ ...view, signerUserId: USER }).success).toBe(false);
    expect(esignatureApplicationView.safeParse({ ...view, ipAddress: "203.0.113.1" }).success).toBe(false);
    const verdict = {
      verdict: "valid",
      explanation: { id: "Sah", en: "Valid" },
      esignatureState: "active",
      esignatureStateAt: null,
      documentState: "current",
      documentStateAt: null,
      signedAt: view.signedAt,
      meaning: "performed",
      signer: view.signer,
      specimenSvg: SPECIMEN,
      keyFingerprint: "f".repeat(64),
      publicKeyPem: "-----BEGIN PUBLIC KEY-----",
      organisation: { name: "Lab" },
      documentType: "calibration_record",
      documentTitle: "Calibration record",
      contentScheme: "calrec-data-v1",
      contentHash: GOLDEN_FULL_HASH,
      canonicalContent: calibrationRecordDataPairs(FULL).map(([n, v]) => [n, v]),
      summary: null,
    };
    expect(publicEsignatureVerdict.parse(verdict)).toMatchObject({ verdict: "valid" });
    expect(publicEsignatureVerdict.safeParse({ ...verdict, token: "x" }).success).toBe(false);
    expect(publicEsignatureVerdict.safeParse({ ...verdict, signer: { ...view.signer, email: "a@b.test" } }).success).toBe(false);
  });
});
