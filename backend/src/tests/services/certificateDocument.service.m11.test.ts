/**
 * M-11 (ADR-095) — the certificate DOCUMENT the frontend renders, and the
 * integrity hashes it prints. Real crypto.
 *
 * The v1 hash is the one every PDF the backend rendered printed. It must not
 * change, or an already-issued printout stops matching its verification page.
 * The oracle for that is the ORIGINAL function, copied verbatim below from
 * certificatePdf.service.js at ce74932 — not the module under test — plus a
 * pinned hex value.
 */
import * as crypto from "crypto";
import { environment } from "../../config/env";
import models from "../../models";

import {
  INTEGRITY_SCHEME_V1,
  INTEGRITY_SCHEME_V2,
  SIGNATURE_KEY_ID,
  buildCanonicalPayload,
  computeContentHash,
  computeIntegrityHash,
  computeSignature,
  getCertificateDocument,
  personName,
  requireSigningSecret,
  resolveVerifyUrl,
  toCertificateDocument,
  type CertificateSource,
} from "../../services/certificateDocument.service";

const processEnv = environment();

// The transform does not hoist jest.mock (jest.transform.js), so the real
// barrel is loaded — it opens no connection until a query — and its finder is
// replaced in each test (jest.config restoreMocks restores spies after each).
let mockFindOne: jest.SpyInstance;

/** certificatePdf.service.js at ce74932, verbatim — the v1 oracle. */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- copied as it was */
const originalCanonicalPayload = (cert: CertificateSource): string =>
  JSON.stringify({
    certificateNumber: cert.certificateNumber,
    tenantId: cert.tenantId,
    deviceId: cert.deviceId,
    calibrationRecordId: cert.calibrationRecordId || null,
    type: cert.type,
    status: cert.status,
    standard: cert.standard || null,
    issueDate: cert.issueDate ? new Date(cert.issueDate).toISOString() : null,
    validUntil: cert.validUntil ? new Date(cert.validUntil).toISOString() : null,
    signedBy: cert.signedBy || null,
    signedAt: cert.signedAt ? new Date(cert.signedAt).toISOString() : null,
  });
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

const cert = (over: Partial<CertificateSource> = {}): CertificateSource => ({
  certificateNumber: "CERT-20260929-RSH-0001",
  tenantId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  calibrationRecordId: "33333333-3333-4333-8333-333333333333",
  type: "calibration",
  status: "signed",
  standard: "ISO 17025",
  issueDate: new Date("2026-09-01T00:00:00.000Z"),
  validUntil: new Date("2027-09-01T00:00:00.000Z"),
  summary: "All points within tolerance",
  conditions: "23 C, 45 % RH",
  notes: "Re-verified after repair",
  calibratedBy: "44444444-4444-4444-8444-444444444444",
  approvedBy: "55555555-5555-4555-8555-555555555555",
  signedBy: "66666666-6666-4666-8666-666666666666",
  signedAt: new Date("2026-09-02T08:00:00.000Z"),
  digitalSignature: "sig-bytes",
  digitalSignatureKeyId: "key-1",
  tenant: { name: "RS Harapan" },
  device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B. Braun", model: "Perfusor" },
  calibratedByUser: { firstName: "Ani", lastName: "Putri" },
  approvedByUser: { firstName: "Budi", lastName: null },
  signedByUser: { firstName: "Citra", lastName: "Dewi" },
  ...over,
});

describe("certificateDocument.service (M-11)", () => {
  const saved = { ...processEnv };
  beforeEach(() => {
    // backend/.env may set it; each test states the configuration it needs.
    delete processEnv["CERT_VERIFY_BASE_URL"];
    mockFindOne = jest.spyOn(models.Certificate, "findOne");
  });
  afterEach(() => {
    Object.assign(processEnv, {
      CERT_VERIFY_BASE_URL: saved["CERT_VERIFY_BASE_URL"],
      PUBLIC_BASE_URL: saved["PUBLIC_BASE_URL"],
    });
    mockFindOne.mockReset();
  });

  describe("v1 — the hash already printed on backend-rendered PDFs is unchanged", () => {
    const fixtures: CertificateSource[] = [
      cert(),
      cert({ status: "revoked" }),
      cert({ standard: "", calibrationRecordId: "", signedBy: "" }),
      cert({ standard: null, calibrationRecordId: null, signedBy: null, signedAt: null, issueDate: null, validUntil: null }),
      { ...cert(), type: undefined, status: undefined } as unknown as CertificateSource,
      cert({ issueDate: "2026-09-01", validUntil: "2027-09-01T07:00:00+07:00" }),
    ];

    it.each(fixtures.map((f, i) => [i, f] as const))("fixture %i: byte-identical to the original payload", (_i, f) => {
      expect(buildCanonicalPayload(f)).toBe(originalCanonicalPayload(f));
      expect(computeIntegrityHash(f)).toBe(sha256(originalCanonicalPayload(f)));
    });

    it("is pinned: a fixed certificate hashes to a fixed value", () => {
      expect(computeIntegrityHash(cert())).toBe(
        sha256(
          '{"certificateNumber":"CERT-20260929-RSH-0001","tenantId":"11111111-1111-4111-8111-111111111111",' +
            '"deviceId":"22222222-2222-4222-8222-222222222222","calibrationRecordId":"33333333-3333-4333-8333-333333333333",' +
            '"type":"calibration","status":"signed","standard":"ISO 17025","issueDate":"2026-09-01T00:00:00.000Z",' +
            '"validUntil":"2027-09-01T00:00:00.000Z","signedBy":"66666666-6666-4666-8666-666666666666",' +
            '"signedAt":"2026-09-02T08:00:00.000Z"}',
        ),
      );
      expect(INTEGRITY_SCHEME_V1).toBe("certificate-canonical-json-v1");
    });

    it("does NOT see summary, conditions or notes — why v2 exists", () => {
      expect(computeIntegrityHash(cert({ summary: "forged" }))).toBe(computeIntegrityHash(cert()));
    });
  });

  describe("v2 — binds every printed column of the certificate row", () => {
    it.each([
      ["summary", { summary: "forged" }],
      ["conditions", { conditions: "forged" }],
      ["notes", { notes: "forged" }],
      ["standard", { standard: "ISO 9001" }],
      ["issueDate", { issueDate: new Date("2026-09-03") }],
      ["validUntil", { validUntil: new Date("2030-01-01") }],
      ["status", { status: "revoked" }],
      ["calibratedBy", { calibratedBy: "77777777-7777-4777-8777-777777777777" }],
      ["approvedBy", { approvedBy: "77777777-7777-4777-8777-777777777777" }],
      ["signedBy", { signedBy: "77777777-7777-4777-8777-777777777777" }],
      ["signedAt", { signedAt: new Date("2026-09-05") }],
      ["digitalSignature", { digitalSignature: "other" }],
      ["digitalSignatureKeyId", { digitalSignatureKeyId: "key-2" }],
      ["deviceId", { deviceId: "88888888-8888-4888-8888-888888888888" }],
      ["certificateNumber", { certificateNumber: "CERT-X" }],
    ] as const)("a change to %s changes the hash", (_field, change) => {
      expect(computeContentHash(cert(change))).not.toBe(computeContentHash(cert()));
    });

    it("is NOT changed by a rename of a referenced person, device or tenant (printed live, not hashed)", () => {
      const renamed = cert({
        tenant: { name: "RS Baru" },
        device: { name: "Renamed", serialNumber: "SN-9", manufacturer: "x", model: "y" },
        signedByUser: { firstName: "Other", lastName: "Name" },
      });
      expect(computeContentHash(renamed)).toBe(computeContentHash(cert()));
    });

    it("names its scheme inside the hashed payload, and treats absent values as null", () => {
      const sparse: CertificateSource = { certificateNumber: "C", tenantId: "t", deviceId: "d" };
      expect(computeContentHash(sparse)).toBe(
        sha256(
          JSON.stringify({
            scheme: INTEGRITY_SCHEME_V2,
            certificateNumber: "C",
            tenantId: "t",
            deviceId: "d",
            calibrationRecordId: null,
            type: null,
            status: null,
            standard: null,
            issueDate: null,
            validUntil: null,
            summary: null,
            conditions: null,
            notes: null,
            calibratedBy: null,
            approvedBy: null,
            signedBy: null,
            signedAt: null,
            digitalSignature: null,
            digitalSignatureKeyId: null,
          }),
        ),
      );
    });
  });

  describe("the document", () => {
    it("carries every printed field, both hashes, and — only when asked — the server HMAC", () => {
      const doc = toCertificateDocument(cert(), { baseUrl: "https://app.test/", withSignature: true });
      expect(doc).toEqual({
        certificateNumber: "CERT-20260929-RSH-0001",
        type: "calibration",
        status: "signed",
        issuedBy: "RS Harapan",
        // A-303: the issuer block (live tenant row, not hashed).
        issuer: { name: "RS Harapan", email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null },
        device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B. Braun", model: "Perfusor" },
        standard: "ISO 17025",
        issueDate: "2026-09-01T00:00:00.000Z",
        validUntil: "2027-09-01T00:00:00.000Z",
        summary: "All points within tolerance",
        conditions: "23 C, 45 % RH",
        notes: "Re-verified after repair",
        calibratedBy: "Ani Putri",
        approvedBy: "Budi",
        signedBy: "Citra Dewi",
        signedAt: "2026-09-02T08:00:00.000Z",
        verifyUrl: "https://app.test/api/v1/certificates/verify/CERT-20260929-RSH-0001",
        integrity: {
          scheme: "certificate-content-v2",
          algorithm: "SHA-256",
          hash: computeContentHash(cert()),
          legacyHash: computeIntegrityHash(cert()),
          signature: computeSignature(computeContentHash(cert())),
          signatureKeyId: SIGNATURE_KEY_ID,
        },
        // ADR-107: no signing snapshot on this row, so it is printed live (v2).
        contentAsOf: "live",
      });
      expect(toCertificateDocument(cert()).integrity).not.toHaveProperty("signature");
    });

    it("prints the signer only for a signed or revoked certificate", () => {
      expect(toCertificateDocument(cert({ status: "approved" }))).toMatchObject({ signedBy: null, signedAt: null });
      expect(toCertificateDocument(cert({ status: "revoked" }))).toMatchObject({ signedBy: "Citra Dewi" });
    });

    it("fills defaults for a sparse row: draft, calibration, nulls", () => {
      const doc = toCertificateDocument({ certificateNumber: "C", tenantId: "t", deviceId: "d", status: null, type: null });
      expect(doc).toMatchObject({
        status: "draft",
        type: "calibration",
        issuedBy: null,
        issuer: null,
        device: null,
        standard: null,
        summary: null,
        calibratedBy: null,
        approvedBy: null,
      });
      expect(
        toCertificateDocument({ certificateNumber: "C", tenantId: "t", deviceId: "d", device: {} }).device,
      ).toEqual({ name: null, serialNumber: null, manufacturer: null, model: null });
    });

    it("never prints an email in place of a name", () => {
      expect(personName({ firstName: "", lastName: "" })).toBeNull();
      expect(personName(null)).toBeNull();
      expect(personName(undefined)).toBeNull();
      expect(personName({ firstName: null, lastName: "Sari" })).toBe("Sari");
    });
  });

  describe("CERT_SIGNING_SECRET", () => {
    it("is required — an empty or absent secret refuses, never a default", () => {
      expect(() => requireSigningSecret("")).toThrow("CERT_SIGNING_SECRET is required (no insecure default)");
      expect(requireSigningSecret("s3cret")).toBe("s3cret");
    });
  });

  describe("resolveVerifyUrl", () => {
    it("prefers CERT_VERIFY_BASE_URL (the verification page), trailing slash removed", () => {
      processEnv["CERT_VERIFY_BASE_URL"] = "https://verify.test/verify/";
      expect(resolveVerifyUrl("CERT-1", "https://ignored.test")).toBe("https://verify.test/verify/CERT-1");
    });

    it("then the caller's base, then PUBLIC_BASE_URL, then localhost", () => {
      delete processEnv["CERT_VERIFY_BASE_URL"];
      processEnv["PUBLIC_BASE_URL"] = "https://public.test/";
      expect(resolveVerifyUrl("CERT-1", "https://caller.test")).toBe("https://caller.test/api/v1/certificates/verify/CERT-1");
      expect(resolveVerifyUrl("CERT-1", "")).toBe("https://public.test/api/v1/certificates/verify/CERT-1");
      delete processEnv["PUBLIC_BASE_URL"];
      expect(resolveVerifyUrl("CERT-1")).toBe("http://localhost:5000/api/v1/certificates/verify/CERT-1");
    });
  });

  describe("getCertificateDocument", () => {
    it("reads in the caller's tenant with every include required:false, and signs the hash", async () => {
      mockFindOne.mockResolvedValueOnce(cert());

      const result = await getCertificateDocument("tenant-a", "cert-1", { baseUrl: "https://app.test" });

      const [options] = mockFindOne.mock.calls[0] as [{ where: object; include: { as: string; required: boolean; attributes?: string[] }[] }];
      expect(options.where).toEqual({ id: "cert-1", tenantId: "tenant-a" });
      expect(options.include.map((i) => [i.as, i.required])).toEqual([
        ["device", false],
        ["tenant", false],
        ["calibratedByUser", false],
        ["approvedByUser", false],
        ["signedByUser", false],
      ]);
      expect(options.include[2]?.attributes).toEqual(["id", "firstName", "lastName"]);
      expect(result).toEqual({
        success: true,
        status: 200,
        data: toCertificateDocument(cert(), { baseUrl: "https://app.test", withSignature: true }),
      });
    });

    it("is a 404 when nothing matches — missing, deleted and another tenant's alike", async () => {
      mockFindOne.mockResolvedValueOnce(null);
      expect(await getCertificateDocument("tenant-a", "cert-1")).toEqual({
        success: false,
        status: 404,
        message: "Certificate not found",
      });
    });
  });
});
