/**
 * Tests for certificatePdf.service.js
 *
 * Covers: generateCertificatePdf, getOrCreatePdf, verifyByCertificateNumber,
 * computeIntegrityHash, computeSignature
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

jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,qrdata"),
}));

jest.mock("fs", () => ({
  readFileSync: jest.fn().mockReturnValue("{{tenantName}}"),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  unlinkSync: jest.fn(),
}));

jest.mock("../../utils/storagePath.util", () => (...parts) => `C:/uploads/${parts.join("/")}`);

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("puppeteer", () => {
  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from("mockpdf")),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    launch: jest.fn().mockResolvedValue(mockBrowser),
  };
});

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

const path = require("path");
const { Certificate } = require("../../models");
const qrCode = require("qrcode");
const fs = require("fs");
const {
  generateCertificatePdf,
  getOrCreatePdf,
  verifyByCertificateNumber,
  computeIntegrityHash,
  computeSignature,
} = require("../../services/certificatePdf.service");

const puppeteer = require("puppeteer");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("certificatePdf.service", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearMocks only clears calls; reset so a persistent mockResolvedValue or a
    // leftover `...Once` queue from one test cannot bleed into the next.
    Certificate.findOne.mockReset();
    fs.existsSync.mockReset();
    fs.existsSync.mockReturnValue(false);
    fs.unlinkSync.mockReset();
    delete process.env.CERT_VERIFY_BASE_URL;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ================================================================
  describe("computeIntegrityHash", () => {
    it("should return a hex hash string", () => {
      const cert = {
        certificateNumber: "CERT-001",
        tenantId: "t-1",
        deviceId: "d-1",
        calibrationRecordId: "cr-1",
        type: "calibration",
        status: "signed",
        standard: "ISO 17025",
        issueDate: new Date("2025-01-01"),
        validUntil: new Date("2026-01-01"),
        signedBy: "u-1",
        signedAt: new Date("2025-06-01"),
      };

      const hash = computeIntegrityHash(cert);

      expect(typeof hash).toBe("string");
      expect(hash).toHaveLength(16);
    });
  });

  // ================================================================
  describe("computeSignature", () => {
    it("should return an hmac signature", () => {
      const sig = computeSignature("mock-hash-abc123");

      expect(typeof sig).toBe("string");
      expect(sig).toHaveLength(21);
    });
  });

  // ================================================================
  describe("generateCertificatePdf", () => {
    it("should generate a PDF for a valid certificate", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
        tenantId: "t-1",
        status: "approved",
        type: "calibration",
        standard: "ISO 17025",
        issueDate: new Date("2025-01-01"),
        validUntil: new Date("2026-01-01"),
        summary: "Passed",
        conditions: "None",
        notes: "",
        tenant: { name: "Test Corp", primaryColor: "#4f46e5" },
        device: { name: "Micrometer", serialNumber: "SN123", manufacturer: "Mitutoyo", model: "293" },
        calibratedByUser: { firstName: "John", lastName: "Doe", email: "john@test.com" },
        approvedByUser: { firstName: "Jane", lastName: "Smith", email: "jane@test.com" },
        signedByUser: { firstName: "Bob", lastName: "Admin", email: "bob@test.com" },
        update: jest.fn().mockResolvedValue({}),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
      expect(result.data.filePath).toContain("/uploads/certificates/");
      expect(result.data.integrityHash).toBe("mock-hash-abc123");
      expect(result.data.signature).toBe("mock-signature-xyz789");
      expect(qrCode.toDataURL).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockCert.update).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: expect.any(String), fileSize: expect.any(Number) }),
      );
    });

    it("should return 404 when certificate not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await generateCertificatePdf("t-1", "nonexistent");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toBe("Certificate not found");
    });

    it("should render a sparse certificate using every placeholder fallback", async () => {
      // Every optional field absent: exercises the `||`/`?.` defaults in renderHtml,
      // buildCanonicalPayload and userName.
      const mockCert = {
        id: "c-1",
        certificateNumber: null,
        update: jest.fn().mockResolvedValue({}),
        // no status/type/standard/dates/summary/conditions/notes/tenant/device
        tenant: null,
        device: null,
        calibratedByUser: { email: "nameless@test.com" }, // no first/last name
        approvedByUser: null,
        signedByUser: null,
      };
      // tenantId omitted -> loadCertificate must query by id alone.
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf(null, "c-1");

      expect(result.success).toBe(true);
      expect(Certificate.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "c-1" } }),
      );
      // A null certificate number used to become "null.pdf". The file name is
      // now random and owes nothing to the number.
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join("C:/uploads/uploads/certificates", "")),
        expect.any(Buffer),
      );
      expect(fs.writeFileSync.mock.calls[0][0]).not.toContain("null.pdf");
    });

    it("should fall back to the neutral status colour for an unrecognised status", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-ODD",
        status: "some_unknown_status",
        update: jest.fn().mockResolvedValue({}),
      });

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
    });

    it("should scope the lookup by tenant when a tenantId is given", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      await generateCertificatePdf("t-1", "c-1");

      expect(Certificate.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "c-1", tenantId: "t-1" } }),
      );
    });

    it("should render a signed certificate with no watermark and a signer", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-SIGNED",
        status: "signed",
        type: "calibration",
        tenant: { name: "Acme", primaryColor: "#000" },
        device: { name: "D" },
        signedByUser: { firstName: "Bob", lastName: "Admin" },
        signedAt: new Date("2025-06-01"),
        update: jest.fn().mockResolvedValue({}),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
      expect(fs.writeFileSync.mock.calls[0][0]).not.toContain("CERT-SIGNED");
    });

    it("should render a revoked certificate", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-REVOKED",
        status: "revoked",
        tenant: { name: "Acme" },
        update: jest.fn().mockResolvedValue({}),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
    });

    it("should not let the certificate number influence the file name at all", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "../../etc/passwd",
        status: "draft",
        update: jest.fn().mockResolvedValue({}),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      // Sanitising the number was never enough: the sanitised form was still a
      // counter. The name is now random, so traversal is not even expressible.
      expect(result.data.filePath).not.toContain("passwd");
      expect(result.data.filePath).not.toContain("..");
      expect(fs.writeFileSync.mock.calls[0][0]).not.toContain("/etc/passwd");
    });

    it("should build the verify URL from CERT_VERIFY_BASE_URL when set", async () => {
      process.env.CERT_VERIFY_BASE_URL = "https://verify.example.com/";
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-001",
        status: "draft",
        update: jest.fn().mockResolvedValue({}),
      });

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.data.verifyUrl).toBe("https://verify.example.com/CERT-001");
      expect(qrCode.toDataURL).toHaveBeenCalledWith(
        "https://verify.example.com/CERT-001",
        expect.any(Object),
      );
    });

    it("should build the verify URL from the caller baseUrl when no env override exists", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-001",
        status: "draft",
        update: jest.fn().mockResolvedValue({}),
      });

      const result = await generateCertificatePdf("t-1", "c-1", { baseUrl: "https://app.test/" });

      expect(result.data.verifyUrl).toBe("https://app.test/api/v1/certificates/verify/CERT-001");
    });

    it("should pass executablePath to puppeteer when PUPPETEER_EXECUTABLE_PATH is set", async () => {
      process.env.PUPPETEER_EXECUTABLE_PATH = "/usr/bin/chromium";
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-001",
        status: "draft",
        update: jest.fn().mockResolvedValue({}),
      });

      await generateCertificatePdf("t-1", "c-1");

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: "/usr/bin/chromium" }),
      );
    });

    it("should omit executablePath when PUPPETEER_EXECUTABLE_PATH is unset", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-001",
        status: "draft",
        update: jest.fn().mockResolvedValue({}),
      });

      await generateCertificatePdf("t-1", "c-1");

      expect(puppeteer.launch.mock.calls[0][0]).not.toHaveProperty("executablePath");
    });

    it("should always close the browser when page.pdf rejects, and propagate the error", async () => {
      const close = jest.fn().mockResolvedValue(undefined);
      puppeteer.launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue({
          setContent: jest.fn().mockResolvedValue(undefined),
          pdf: jest.fn().mockRejectedValue(new Error("render crashed")),
        }),
        close,
      });
      const update = jest.fn();
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-001",
        status: "draft",
        update,
      });

      await expect(generateCertificatePdf("t-1", "c-1")).rejects.toThrow("render crashed");

      expect(close).toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("getOrCreatePdf", () => {
    it("should return cached PDF if it exists", async () => {
      fs.existsSync.mockReturnValueOnce(true);
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
        filePath: "/uploads/certificates/CERT-001.pdf",
        fileSize: 102400,
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await getOrCreatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
      expect(result.data.absPath).toContain("CERT-001.pdf");
      expect(result.data.fileSize).toBe(102400);
    });

    it("should generate PDF if not cached", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-002",
        tenantId: "t-1",
        status: "approved",
        type: "calibration",
        standard: "ISO 17025",
        issueDate: new Date("2025-01-01"),
        validUntil: new Date("2026-01-01"),
        summary: "Passed",
        conditions: "None",
        notes: "",
        tenant: { name: "Test Corp", primaryColor: "#4f46e5" },
        device: { name: "Caliper", serialNumber: "SN456", manufacturer: "Mitutoyo", model: "500" },
        calibratedByUser: { firstName: "John", lastName: "Doe" },
        approvedByUser: { firstName: "Jane", lastName: "Smith" },
        signedByUser: null,
        update: jest.fn().mockResolvedValue({}),
      };
      // getOrCreatePdf calls loadCertificate first, then generateCertificatePdf calls it again
      Certificate.findOne.mockResolvedValue(mockCert);

      const result = await getOrCreatePdf("t-1", "c-1");

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it("should return 404 when certificate not found", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await getOrCreatePdf("t-1", "nonexistent");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should regenerate when the recorded filePath no longer exists on disk", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-003",
        status: "draft",
        filePath: "/uploads/certificates/CERT-003.pdf",
        fileSize: 10,
        update: jest.fn().mockResolvedValue({}),
      };
      Certificate.findOne.mockResolvedValue(mockCert);
      fs.existsSync.mockReturnValue(false); // stale DB row, file gone

      const result = await getOrCreatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
      expect(result.data.fileName).toBe("CERT-003.pdf");
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should propagate the 404 when generation cannot find the certificate", async () => {
      // Found on the first load, gone by the time generateCertificatePdf re-loads it.
      Certificate.findOne
        .mockResolvedValueOnce({ id: "c-1", certificateNumber: "CERT-004", status: "draft" })
        .mockResolvedValueOnce(null);

      const result = await getOrCreatePdf("t-1", "c-1");

      expect(result).toEqual({ success: false, status: 404, message: "Certificate not found" });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("verifyByCertificateNumber", () => {
    it("should verify a valid certificate", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
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

      const result = await verifyByCertificateNumber("CERT-001");

      expect(result.success).toBe(true);
      expect(result.data.found).toBe(true);
      expect(result.data.valid).toBe(true);
      expect(result.data.status).toBe("signed");
      expect(result.data.integrityHash).toBe("mock-hash-abc123");
      expect(result.data.documentUrl).toBe("/uploads/certificates/CERT-001.pdf");
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

        const result = await verifyByCertificateNumber("CERT-009");

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

        const result = await verifyByCertificateNumber("CERT-009");

        expect(result.data).toMatchObject({ found: true, valid: false, withdrawn: true, documentUrl: null });
      });

      it("a live certificate is not withdrawn", async () => {
        Certificate.findOne.mockImplementationOnce(
          paranoidAware({ ...deletedRow("signed"), deletedAt: null }),
        );

        const result = await verifyByCertificateNumber("CERT-009");

        expect(result.data).toMatchObject({ valid: true, withdrawn: false });
      });
    });

    it("should return not found for unknown certificate number", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);

      const result = await verifyByCertificateNumber("UNKNOWN");

      expect(result.success).toBe(true);
      expect(result.data.found).toBe(false);
      expect(result.data.valid).toBe(false);
      expect(result.data.message).toBe("No certificate matches this number.");
    });

    it("should mark revoked certificate as not valid", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
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

      const result = await verifyByCertificateNumber("CERT-001");

      expect(result.data.valid).toBe(false);
      expect(result.data.revoked).toBe(true);
    });

    it("should mark expired certificate as not valid", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "CERT-001",
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

      const result = await verifyByCertificateNumber("CERT-001");

      expect(result.data.valid).toBe(false);
      expect(result.data.expired).toBe(true);
    });

    it("should null out the optional fields of a sparse certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-005",
        status: "draft",
        type: "calibration",
        // no standard, no tenant, no device, no validUntil, no signer
      });

      const result = await verifyByCertificateNumber("CERT-005");

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
        status: "draft",
        validUntil: new Date("2099-01-01"),
        tenant: { name: "Acme" },
      });

      const result = await verifyByCertificateNumber("CERT-006");

      expect(result.data.valid).toBe(false);
      expect(result.data.issuedTo).toBe("Acme");
    });

    it("should honour the caller baseUrl in the returned verifyUrl", async () => {
      Certificate.findOne.mockResolvedValueOnce({
        certificateNumber: "CERT-007",
        status: "signed",
      });

      const result = await verifyByCertificateNumber("CERT-007", { baseUrl: "https://x.test" });

      expect(result.data.verifyUrl).toBe("https://x.test/api/v1/certificates/verify/CERT-007");
    });
  });

  // ================================================================
  // ADR-042 step 1 — S-01: the file name is not the certificate number
  // ================================================================
  describe("PDF file naming (ADR-042 step 1 / S-01)", () => {
    const CERT_DIR = "C:/uploads/uploads/certificates";
    const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const RANDOM_NAME = new RegExp(`^\\d+-\\d+-${UUID_RE}\\.pdf$`);

    const certFixture = (over = {}) => ({
      id: "c-1",
      certificateNumber: "CERT-20260923-ACME-0001",
      tenantId: "t-1",
      status: "signed",
      tenant: { name: "Acme" },
      update: jest.fn().mockResolvedValue({}),
      ...over,
    });

    it("writes the PDF under a random, unguessable name, not the certificate number", async () => {
      const mockCert = certFixture();
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      const written = fs.writeFileSync.mock.calls[0][0];
      const fileName = path.basename(written);
      expect(fileName).toMatch(RANDOM_NAME);
      expect(fileName).not.toContain("CERT-20260923-ACME-0001");
      expect(fileName).not.toContain("CERT");
      expect(result.data.filePath).toBe(`/uploads/certificates/${fileName}`);
      expect(mockCert.update).toHaveBeenCalledWith({
        filePath: result.data.filePath,
        fileSize: expect.any(Number),
      });
    });

    it("gives two certificates issued in sequence unrelated file names", async () => {
      // The certificate numbers differ by one. The file names must not.
      const first = certFixture({ certificateNumber: "CERT-20260923-ACME-0001" });
      const second = certFixture({ id: "c-2", certificateNumber: "CERT-20260923-ACME-0002" });

      Certificate.findOne.mockResolvedValueOnce(first);
      const r1 = await generateCertificatePdf("t-1", "c-1");
      Certificate.findOne.mockResolvedValueOnce(second);
      const r2 = await generateCertificatePdf("t-1", "c-2");

      const n1 = path.basename(r1.data.filePath);
      const n2 = path.basename(r2.data.filePath);

      expect(n1).toMatch(RANDOM_NAME);
      expect(n2).toMatch(RANDOM_NAME);
      expect(n1).not.toBe(n2);
      // Not derivable: neither name carries the number, its sanitised form, or
      // the per-tenant prefix a walker would enumerate from.
      for (const n of [n1, n2]) {
        expect(n).not.toContain("CERT-20260923-ACME-0001");
        expect(n).not.toContain("CERT-20260923-ACME-0002");
        expect(n).not.toContain("CERT_20260923_ACME_0001");
        expect(n).not.toContain("ACME");
      }
      // The unguessable segment really differs between the two — not just the
      // timestamp prefix, which two certificates issued in the same millisecond
      // would share.
      const uuidOf = (n) => n.match(new RegExp(UUID_RE))[0];
      expect(uuidOf(n1)).not.toBe(uuidOf(n2));
    });

    it("unlinks the superseded file when a certificate is regenerated", async () => {
      const mockCert = certFixture({ filePath: "/uploads/certificates/old-random-name.pdf" });
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(CERT_DIR, "old-random-name.pdf"),
      );
      // The new name differs, so the old URL 404s instead of serving a
      // superseded document from the unauthenticated mount forever.
      expect(result.data.filePath).not.toContain("old-random-name");
      // Unlinked only after the row points at the new file.
      expect(mockCert.update.mock.invocationCallOrder[0]).toBeLessThan(
        fs.unlinkSync.mock.invocationCallOrder[0],
      );
    });

    it("does not unlink anything when the certificate had no previous file", async () => {
      Certificate.findOne.mockResolvedValueOnce(certFixture({ filePath: null }));

      await generateCertificatePdf("t-1", "c-1");

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("still succeeds when the superseded file is already gone", async () => {
      fs.unlinkSync.mockImplementationOnce(() => {
        const err = new Error("ENOENT: no such file or directory");
        err.code = "ENOENT";
        throw err;
      });
      Certificate.findOne.mockResolvedValueOnce(
        certFixture({ filePath: "/uploads/certificates/already-gone.pdf" }),
      );

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        "Superseded certificate PDF could not be removed",
        expect.objectContaining({ certificateId: "c-1" }),
      );
    });

    it("confines the unlink to the certificates directory", async () => {
      Certificate.findOne.mockResolvedValueOnce(
        certFixture({ filePath: "/uploads/certificates/../../../etc/passwd" }),
      );

      await generateCertificatePdf("t-1", "c-1");

      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(CERT_DIR, "passwd"));
    });

    it("keeps the download name readable while the file on disk stays random", async () => {
      // res.download(absPath, fileName): the disk path is the random one, the
      // saved-as name is still the certificate number.
      fs.existsSync.mockReturnValueOnce(true);
      Certificate.findOne.mockResolvedValueOnce({
        id: "c-1",
        certificateNumber: "CERT-20260923-ACME-0001",
        filePath:
          "/uploads/certificates/1758600000000-4242-11111111-2222-3333-4444-555555555555.pdf",
        fileSize: 4096,
      });

      const result = await getOrCreatePdf("t-1", "c-1");

      expect(result.data.fileName).toBe("CERT-20260923-ACME-0001.pdf");
      expect(result.data.absPath).toContain("1758600000000-4242-");
      expect(result.data.absPath).not.toContain("CERT-20260923");
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
      type: "calibration",
      tenant: { name: "Acme" },
      filePath:
        "/uploads/certificates/1758600000000-4242-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf",
      ...over,
    });

    it("does not publish the document of a draft certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "draft" }));

      const result = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      expect(result.data.found).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.status).toBe("draft");
      expect(result.data.documentUrl).toBeNull();
    });

    it("does not publish the document of a certificate awaiting approval", async () => {
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "pending_approval" }));

      const result = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      expect(result.data.documentUrl).toBeNull();
    });

    it("publishes a working API-relative path for an issued certificate", async () => {
      const cert = withFile({ status: "signed", validUntil: new Date("2099-01-01") });
      Certificate.findOne.mockResolvedValueOnce(cert);

      const result = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      expect(result.data.valid).toBe(true);
      expect(result.data.documentUrl).toBe(cert.filePath);
      // API-origin-relative: the verify page renders `${API_BASE_URL}${documentUrl}`.
      expect(result.data.documentUrl.startsWith("/uploads/certificates/")).toBe(true);
    });

    it("does not publish the document of a revoked certificate", async () => {
      // DECISION (ADR-042 step 2): revoked returns null. The reasoning is on the
      // gate in certificatePdf.service.js.
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "revoked" }));

      const result = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      expect(result.data.revoked).toBe(true);
      expect(result.data.status).toBe("revoked");
      expect(result.data.documentUrl).toBeNull();
    });

    it("still publishes the document of an expired but properly issued certificate", async () => {
      // Expiry is not un-issuance: the document was signed and is real history.
      const cert = withFile({ status: "signed", validUntil: new Date("2020-01-01") });
      Certificate.findOne.mockResolvedValueOnce(cert);

      const result = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      expect(result.data.expired).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.documentUrl).toBe(cert.filePath);
    });

    it("returns null rather than undefined when an issued certificate has no file yet", async () => {
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "signed", filePath: null }));

      const result = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      expect(result.data.documentUrl).toBeNull();
    });

    it("adds no new distinguisher between a nonexistent and an unissued certificate", async () => {
      Certificate.findOne.mockResolvedValueOnce(null);
      const missing = await verifyByCertificateNumber("CERT-20260923-ACME-9999");
      Certificate.findOne.mockResolvedValueOnce(withFile({ status: "draft" }));
      const unissued = await verifyByCertificateNumber("CERT-20260923-ACME-0001");

      // Both withhold the document, so the gate introduces no oracle of its own.
      // (The pre-existing disclosure of tenant/device/date fields for a found
      // certificate is wider than this and is untouched here — see the report.)
      expect(missing.data.documentUrl ?? null).toBeNull();
      expect(unissued.data.documentUrl).toBeNull();
      expect(missing.data.found).toBe(false);
      expect(unissued.data.found).toBe(true);
    });
  });
});
