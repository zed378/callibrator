/**
 * Tests for certificatePdf.service.js — public verification and the PDFs the
 * backend STORED before M-11 (ADR-095). The backend renders no PDF any more:
 * the document data and the integrity hashes are certificateDocument.service
 * (certificateDocument.service.m11.test.ts).
 *
 * Covers: getStoredPdf, verifyByCertificateNumber (incl. the published
 * `document` and `integrity`), getVerifiedDocument, and the re-exported
 * computeIntegrityHash / computeSignature / SIGNATURE_KEY_ID.
 */

jest.mock("../../config", () => ({
  Sequelize: { useCLS: jest.fn() },
  db: {},
}));

jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(),
    update: jest.fn(),
  },
  CalibrationDevice: {},
  Tenant: {},
  User: {},
}));

jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
}));

jest.mock("../../utils/storagePath.util", () => (...parts) => `C:/uploads/${parts.join("/")}`);

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return {
    ...actual,
    createHash: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("mock-hash-abc123"),
    }),
    createHmac: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue("mock-signature-xyz789"),
    }),
  };
});

const { Certificate, CalibrationDevice, Tenant, User } = require("../../models");
const fs = require("fs");
const service = require("../../services/certificatePdf.service");
const certificateDocument = require("../../services/certificateDocument.service");

const {
  getStoredPdf,
  verifyByCertificateNumber,
  getVerifiedDocument,
  mintDocumentUrl,
  computeIntegrityHash,
  computeSignature,
} = service;

// A-293 (ADR-100): the full verdict needs the certificate's own verification
// token. These suites describe the FULL verdict, so every row carries TOKEN and
// every call presents it (verifyFull). The minimal verdict is pinned by
// routes/certificateVerify.a293.test.ts over the real model.
const TOKEN = "Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";
const verifyFull = (certificateNumber, options = {}) =>
  verifyByCertificateNumber(certificateNumber, { ...options, token: TOKEN });

/** The token a minted capability carries. */
const tokenFor = (certificateNumber) =>
  new URL(`https://h${mintDocumentUrl(certificateNumber)}`).searchParams.get("token");

describe("certificatePdf.service", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearMocks only clears calls; reset so a persistent mockResolvedValue or a
    // leftover `...Once` queue from one test cannot bleed into the next.
    Certificate.findOne.mockReset();
    fs.existsSync.mockReset();
    fs.existsSync.mockReturnValue(false);
    delete process.env.CERT_VERIFY_BASE_URL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ================================================================
  describe("renders nothing (M-11, ADR-095)", () => {
    it("exports no renderer, and re-exports the integrity functions from certificateDocument.service", () => {
      expect(service.generateCertificatePdf).toBeUndefined();
      expect(service.getOrCreatePdf).toBeUndefined();
      expect(computeIntegrityHash).toBe(certificateDocument.computeIntegrityHash);
      expect(computeSignature).toBe(certificateDocument.computeSignature);
      expect(service.SIGNATURE_KEY_ID).toBe(certificateDocument.SIGNATURE_KEY_ID);
    });
  });

  // ================================================================
  describe("getStoredPdf — a PDF the backend stored before M-11", () => {
    it("returns the stored file under its readable download name, looked up in the caller's tenant", async () => {
      fs.existsSync.mockReturnValueOnce(true);
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-001",
        filePath: "certificates/1758600000000-4242-aaaa.pdf",
        fileSize: 102400,
      });

      const result = await getStoredPdf("t-1", "c-1");

      expect(Certificate.findOne).toHaveBeenCalledWith({
        where: { id: "c-1", tenantId: "t-1" },
        attributes: ["id", "certificateNumber", "filePath", "fileSize"],
      });
      expect(result).toEqual({
        success: true,
        status: 200,
        data: {
          absPath: "C:/uploads/uploads/certificates/1758600000000-4242-aaaa.pdf",
          fileName: "CERT-001.pdf",
          fileSize: 102400,
        },
      });
    });

    it("is a 404 when the certificate is not found (missing, deleted or another tenant's)", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      expect(await getStoredPdf("t-1", "nope")).toEqual({
        success: false,
        status: 404,
        message: "Certificate not found",
      });
    });

    it("renders nothing for a certificate with no stored PDF: a 404 naming the document route", async () => {
      Certificate.findOne.mockResolvedValueOnce({ id: "c-1", certificateNumber: "CERT-002", filePath: null });

      const result = await getStoredPdf("t-1", "c-1");

      expect(result.status).toBe(404);
      expect(result.message).toMatch(/GET \/certificates\/:id\/document/);
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it("is the same 404 when the recorded file is gone from disk", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-003",
        filePath: "certificates/x.pdf",
      });
      fs.existsSync.mockReturnValueOnce(false);

      const result = await getStoredPdf("t-1", "c-1");

      expect(result.status).toBe(404);
      expect(result.message).toMatch(/no stored PDF/);
    });

    it("confines the lookup to the certificates directory whatever the stored value says", async () => {
      fs.existsSync.mockReturnValueOnce(true);
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT/../004",
        filePath: "../../../etc/passwd",
      });

      const result = await getStoredPdf("t-1", "c-1");

      expect(result.data.absPath).toBe("C:/uploads/uploads/certificates/passwd");
      expect(result.data.fileName).toBe("CERT_.._004.pdf");
    });
  });

  // ================================================================
  describe("verifyByCertificateNumber — what is published (M-11)", () => {
    const signedCert = (over = {}) => ({
      id: "c-1",
      certificateNumber: "CERT-100",
      verificationToken: TOKEN,
      tenantId: "t-1",
      deviceId: "d-1",
      type: "calibration",
      status: "signed",
      standard: "ISO 17025",
      issueDate: new Date("2026-01-01"),
      validUntil: new Date("2099-01-01"),
      summary: "Within tolerance",
      tenant: { name: "RS Harapan" },
      device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B", model: "M" },
      calibratedByUser: { firstName: "Ani", lastName: "Putri" },
      approvedByUser: { firstName: "Budi", lastName: "S" },
      signedByUser: { firstName: "Citra", lastName: "D" },
      signedAt: new Date("2026-01-02"),
      filePath: null,
      ...over,
    });

    it("reads with every include required:false and paranoid off", async () => {
      Certificate.findOne.mockResolvedValueOnce(signedCert());

      await verifyFull("CERT-100");

      const options = Certificate.findOne.mock.calls[0][0];
      expect(options).toMatchObject({ where: { certificateNumber: "CERT-100" }, paranoid: false });
      expect(options.include.map((i) => [i.model, i.as, i.required])).toEqual([
        [CalibrationDevice, "device", false],
        [Tenant, "tenant", false],
        [User, "calibratedByUser", false],
        [User, "approvedByUser", false],
        [User, "signedByUser", false],
      ]);
      // Names only: a staff member's email is never read for a public answer.
      expect(options.include[2].attributes).toEqual(["id", "firstName", "lastName"]);
    });

    it("publishes a signed certificate's DOCUMENT (without the server HMAC) and the v2 integrity", async () => {
      Certificate.findOne.mockResolvedValueOnce(signedCert());

      const { data } = await verifyFull("CERT-100", { baseUrl: "https://x.test" });

      expect(data.document).toMatchObject({
        certificateNumber: "CERT-100",
        status: "signed",
        issuedBy: "RS Harapan",
        device: { name: "Infusion pump", serialNumber: "SN-9", manufacturer: "B", model: "M" },
        summary: "Within tolerance",
        calibratedBy: "Ani Putri",
        approvedBy: "Budi S",
        signedBy: "Citra D",
        verifyUrl: `https://x.test/api/v1/certificates/verify/CERT-100?token=${TOKEN}`,
      });
      expect(data.document.integrity).toEqual({
        scheme: "certificate-content-v2",
        algorithm: "SHA-256",
        hash: "mock-hash-abc123",
        legacyHash: "mock-hash-abc123",
      });
      expect(data.integrity).toEqual(data.document.integrity);
      expect(data.integrityHash).toBe(data.document.integrity.legacyHash);
      expect(data.signedBy).toBe("Citra D");
      // No stored file: no stored-document capability.
      expect(data.documentUrl).toBeNull();
    });

    it.each(["draft", "pending_approval", "approved", "revoked"])(
      "publishes no document for a %s certificate",
      async (status) => {
        Certificate.findOne.mockResolvedValueOnce(signedCert({ status }));

        const { data } = await verifyFull("CERT-100");

        expect(data.document).toBeNull();
        expect(data.integrity.hash).toBe("mock-hash-abc123");
      },
    );

    it("publishes no document for a withdrawn (soft-deleted) signed certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce(signedCert({ deletedAt: new Date("2026-09-01") }));

      const { data } = await verifyFull("CERT-100");

      expect(data.withdrawn).toBe(true);
      expect(data.document).toBeNull();
    });

    it("still publishes an expired, properly issued certificate's document", async () => {
      Certificate.findOne.mockResolvedValueOnce(signedCert({ validUntil: new Date("2020-01-01") }));

      const { data } = await verifyFull("CERT-100");

      expect(data.expired).toBe(true);
      expect(data.document).not.toBeNull();
    });
  });

  // ================================================================
  describe("getVerifiedDocument — the stored PDF behind the verification capability", () => {
    it("refuses a malformed or expired token before touching the database", async () => {
      const result = await getVerifiedDocument("CERT-200", "garbage");

      expect(result).toEqual({ success: false, status: 403, message: "Invalid or expired document link" });
      expect(Certificate.findOne).not.toHaveBeenCalled();
    });

    it("is a 404 for a certificate that is not signed, has no stored file, or does not exist", async () => {
      const token = tokenFor("CERT-200");
      Certificate.findOne.mockResolvedValueOnce({
        id: "c",
        certificateNumber: "CERT-200",
        status: "revoked",
        filePath: "certificates/a.pdf",
      });
      expect((await getVerifiedDocument("CERT-200", token)).status).toBe(404);
      Certificate.findOne.mockResolvedValueOnce({ id: "c", certificateNumber: "CERT-200", status: "signed", filePath: null });
      expect((await getVerifiedDocument("CERT-200", token)).status).toBe(404);
      Certificate.findOne.mockResolvedValueOnce(null);
      expect((await getVerifiedDocument("CERT-200", token)).status).toBe(404);
    });

    it("is a 410 when the stored file is gone, and serves it when present", async () => {
      const token = tokenFor("CERT-200");
      const row = { id: "c", certificateNumber: "CERT-200", status: "signed", filePath: "certificates/a.pdf" };
      Certificate.findOne.mockResolvedValueOnce(row);
      fs.existsSync.mockReturnValueOnce(false);
      expect((await getVerifiedDocument("CERT-200", token)).status).toBe(410);

      Certificate.findOne.mockResolvedValueOnce(row);
      fs.existsSync.mockReturnValueOnce(true);
      expect(await getVerifiedDocument("CERT-200", token)).toEqual({
        success: true,
        status: 200,
        data: { absPath: "C:/uploads/uploads/certificates/a.pdf", fileName: "CERT-200.pdf" },
      });
    });
  });

  // ================================================================
  describe("verifyByCertificateNumber", () => {
    it("should verify a valid certificate", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
        verificationToken: TOKEN,
        type: "calibration",
        standard: "ISO 17025",
        status: "signed",
        issuedTo: "Test Corp",
        issueDate: new Date("2025-01-01"),
        validUntil: new Date("2027-01-01"),
        tenant: { name: "Test Corp" },
        device: { name: "Micrometer", serialNumber: "SN123" },
        signedByUser: { firstName: "Bob", lastName: "Admin" },
        signedAt: new Date("2025-06-01"),
        filePath: "/uploads/certificates/CERT-001.pdf",
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await verifyFull("CERT-001");

      expect(result.success).toBe(true);
      expect(result.data.found).toBe(true);
      expect(result.data.valid).toBe(true);
      expect(result.data.status).toBe("signed");
      expect(result.data.integrityHash).toBe("mock-hash-abc123");
      expect(result.data.signedBy).toBe("Bob Admin");
      // ADR-042 step 4: a capability for this certificate's document, not a path.
      expect(result.data.documentUrl).toMatch(
        /^\/api\/v1\/certificates\/verify\/CERT-001\/document\?token=\d+\./,
      );
    });

    // A-130 (F-11, ADR-051 A-107). The double honours `paranoid` the way
    // Sequelize does: a soft-deleted row is returned only with
    // `paranoid: false`. Fail-before: the lookup used the default (paranoid)
    // scope, so a deleted REVOKED certificate answered "No certificate matches
    // this number" — to a third party, a forgery.
    describe("A-130 — a soft-deleted certificate is still reported", () => {
      const deletedRow = (status) => ({
        id: "c-9",
        certificateNumber: "CERT-009",
        verificationToken: TOKEN,
        type: "calibration",
        status,
        issueDate: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
        tenant: { name: "Test Corp" },
        signedAt: new Date("2025-06-01"),
        filePath: "/uploads/certificates/CERT-009.pdf",
        deletedAt: new Date("2026-09-01"),
      });
      const paranoidAware = (row) => async (options) =>
        row.deletedAt && options.paranoid !== false ? null : row;

      it("a deleted revoked certificate still says revoked, withdrawn, and not valid", async () => {
        Certificate.findOne.mockImplementationOnce(paranoidAware(deletedRow("revoked")));

        const result = await verifyFull("CERT-009");

        expect(Certificate.findOne.mock.calls[0][0]).toMatchObject({
          where: { certificateNumber: "CERT-009" },
          paranoid: false,
        });
        expect(result.data).toMatchObject({
          found: true,
          valid: false,
          status: "revoked",
          revoked: true,
          withdrawn: true,
          documentUrl: null,
        });
      });

      it("a withdrawn signed certificate is never valid and publishes no document", async () => {
        Certificate.findOne.mockImplementationOnce(paranoidAware(deletedRow("signed")));

        const result = await verifyFull("CERT-009");

        expect(result.data).toMatchObject({ found: true, valid: false, withdrawn: true, documentUrl: null });
      });

      it("a live certificate is not withdrawn", async () => {
        Certificate.findOne.mockImplementationOnce(
          paranoidAware({ ...deletedRow("signed"), deletedAt: null }),
        );

        const result = await verifyFull("CERT-009");

        expect(result.data).toMatchObject({ valid: true, withdrawn: false });
      });
    });

    it("should return not found for unknown certificate number", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await verifyFull("UNKNOWN");

      expect(result.success).toBe(true);
      expect(result.data.found).toBe(false);
      expect(result.data.valid).toBe(false);
      expect(result.data.message).toBe("No certificate matches this number.");
    });

    it("should mark revoked certificate as not valid", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
        verificationToken: TOKEN,
        status: "revoked",
        type: "calibration",
        standard: "ISO 17025",
        issueDate: new Date("2025-01-01"),
        validUntil: new Date("2027-01-01"),
        tenant: { name: "Test Corp" },
        device: null,
        signedByUser: null,
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await verifyFull("CERT-001");

      expect(result.data.valid).toBe(false);
      expect(result.data.revoked).toBe(true);
    });

    it("should mark expired certificate as not valid", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
        verificationToken: TOKEN,
        status: "signed",
        type: "calibration",
        standard: "ISO 17025",
        issueDate: new Date("2020-01-01"),
        validUntil: new Date("2024-01-01"),
        tenant: { name: "Test Corp" },
        device: null,
        signedByUser: null,
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await verifyFull("CERT-001");

      expect(result.data.valid).toBe(false);
      expect(result.data.expired).toBe(true);
    });

    it("should null out the optional fields of a sparse certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-005",
        verificationToken: TOKEN,
        status: "draft",
        type: "calibration",
        // no standard, no tenant, no device, no validUntil, no signer
      });

      const result = await verifyFull("CERT-005");

      expect(result.data).toMatchObject({
        found: true,
        valid: false,
        expired: false,
        revoked: false,
        standard: null,
        issuedTo: null,
        device: null,
        signedBy: null,
      });
    });

    it("should treat a draft certificate as not valid even when unexpired", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        certificateNumber: "CERT-006",
        verificationToken: TOKEN,
        status: "draft",
        validUntil: new Date("2099-01-01"),
        tenant: { name: "Acme" },
      });

      const result = await verifyFull("CERT-006");

      expect(result.data.valid).toBe(false);
      expect(result.data.issuedTo).toBe("Acme");
    });

    it("should honour the caller baseUrl in the returned verifyUrl", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        certificateNumber: "CERT-007",
        verificationToken: TOKEN,
        status: "signed",
      });

      const result = await verifyFull("CERT-007", { baseUrl: "https://x.test" });

      expect(result.data.verifyUrl).toBe(`https://x.test/api/v1/certificates/verify/CERT-007?token=${TOKEN}`);
    });
  });

  // ================================================================
  // ADR-042 step 2 — A-57: the public endpoint does not publish an
  // unissued or revoked document
  // ================================================================
  describe("verifyByCertificateNumber documentUrl gate (ADR-042 step 2 / A-57)", () => {
    const withFile = (over) => ({
      id: "c-1",
      certificateNumber: "CERT-20260923-ACME-0001",
      verificationToken: TOKEN,
      type: "calibration",
      tenant: { name: "Acme" },
      filePath:
        "/uploads/certificates/1758600000000-4242-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf",
      ...over,
    });

    it("does not publish the document of a draft certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "draft" }));

      const result = await verifyFull("CERT-20260923-ACME-0001");

      expect(result.data.found).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.status).toBe("draft");
      expect(result.data.documentUrl).toBeNull();
    });

    it("does not publish the document of a certificate awaiting approval", async () => {
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "pending_approval" }));

      const result = await verifyFull("CERT-20260923-ACME-0001");

      expect(result.data.documentUrl).toBeNull();
    });

    it("publishes an API-relative document capability for an issued certificate (ADR-042 step 4)", async () => {
      const cert = withFile({ status: "signed", validUntil: new Date("2099-01-01") });
      Certificate.findOne.mockResolvedValueOnce(cert);

      const result = await verifyFull("CERT-20260923-ACME-0001");

      expect(result.data.valid).toBe(true);
      // API-origin-relative: the verify page renders `${API_BASE_URL}${documentUrl}`.
      expect(result.data.documentUrl.startsWith(
        "/api/v1/certificates/verify/CERT-20260923-ACME-0001/document?token=",
      )).toBe(true);
      // The file's own path is never published.
      expect(result.data.documentUrl).not.toContain("uploads");
    });

    it("does not publish the document of a revoked certificate", async () => {
      // DECISION (ADR-042 step 2): revoked returns null. The reasoning is on the
      // gate in certificatePdf.service.js.
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "revoked" }));

      const result = await verifyFull("CERT-20260923-ACME-0001");

      expect(result.data.revoked).toBe(true);
      expect(result.data.status).toBe("revoked");
      expect(result.data.documentUrl).toBeNull();
    });

    it("still publishes the document of an expired but properly issued certificate", async () => {
      // Expiry is not un-issuance: the document was signed and is real history.
      const cert = withFile({ status: "signed", validUntil: new Date("2020-01-01") });
      Certificate.findOne.mockResolvedValueOnce(cert);

      const result = await verifyFull("CERT-20260923-ACME-0001");

      expect(result.data.expired).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.documentUrl).toContain("/document?token=");
    });

    it("returns null rather than undefined when an issued certificate has no file yet", async () => {
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "signed", filePath: null }));

      const result = await verifyFull("CERT-20260923-ACME-0001");

      expect(result.data.documentUrl).toBeNull();
    });

    it("adds no new distinguisher between a nonexistent and an unissued certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);
      const missing = await verifyFull("CERT-20260923-ACME-9999");
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "draft" }));
      const unissued = await verifyFull("CERT-20260923-ACME-0001");

      // Both withhold the document, so the gate introduces no oracle of its own.
      // (The pre-existing disclosure of tenant/device/date fields for a found
      // certificate is wider than this and is untouched here — see the report.)
      expect(missing.data.documentUrl ?? null).toBeNull();
      expect(unissued.data.documentUrl).toBeNull();
      expect(missing.data.found).toBe(false);
      expect(unissued.data.found).toBe(true);
    });
  });

  // ================================================================
  // A-293 (ADR-100) — without the certificate's own token, the minimal verdict.
  // ================================================================
  describe("verifyByCertificateNumber — the minimal verdict (A-293)", () => {
    const sparse = {
      certificateNumber: "CERT-008",
      status: "signed",
      type: "calibration",
      verificationToken: TOKEN,
      device: { name: "Pump", serialNumber: "SN-8" },
      signedByUser: { firstName: "Dewi", lastName: "S" },
    };

    it("a sparse certificate with no issuer: issuedTo null, and nothing identifying", async () => {
      Certificate.findOne.mockResolvedValueOnce(sparse);

      const { data } = await verifyByCertificateNumber("CERT-008");

      expect(data).toEqual({
        found: true,
        valid: true,
        status: "signed",
        revoked: false,
        expired: false,
        withdrawn: false,
        certificateNumber: "CERT-008",
        type: "calibration",
        issuedTo: null,
        issueDate: undefined,
        validUntil: undefined,
        integrity: {
          scheme: "certificate-content-v2",
          algorithm: "SHA-256",
          hash: "mock-hash-abc123",
          legacyHash: "mock-hash-abc123",
        },
        disclosure: "minimal",
      });
    });

    it("a row with no token never matches, even a presented one", async () => {
      Certificate.findOne.mockResolvedValueOnce({ ...sparse, verificationToken: null });

      const { data } = await verifyByCertificateNumber("CERT-008", { token: TOKEN });

      expect(data.disclosure).toBe("minimal");
    });
  });
});
