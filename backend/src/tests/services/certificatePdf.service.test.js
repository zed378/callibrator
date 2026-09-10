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
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join("C:/uploads/uploads/certificates", "null.pdf"),
        expect.any(Buffer),
      );
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
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join("C:/uploads/uploads/certificates", "CERT-SIGNED.pdf"),
        expect.any(Buffer),
      );
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

    it("should sanitise the certificate number when building the file name", async () => {
      const mockCert = {
        id: "c-1",
        certificateNumber: "../../etc/passwd",
        status: "draft",
        update: jest.fn().mockResolvedValue({}),
      };
      Certificate.findOne.mockResolvedValueOnce(mockCert);

      const result = await generateCertificatePdf("t-1", "c-1");

      expect(result.data.filePath).toBe("/uploads/certificates/.._.._etc_passwd.pdf");
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
});
