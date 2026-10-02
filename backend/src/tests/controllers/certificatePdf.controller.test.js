jest.mock("../../services/certificatePdf.service", () => ({
  getStoredPdf: jest.fn(),
  verifyByCertificateNumber: jest.fn(),
}));
// M-11 (ADR-095): the backend serves the certificate DOCUMENT; it renders no PDF.
jest.mock("../../services/certificateDocument.service", () => ({
  getCertificateDocument: jest.fn(),
}));

// The validator module is NOT mocked: the certificate id goes through the real
// Zod schema, so it is a real uuid here.
const CERT_ID = "5a0e8400-e29b-41d4-a716-446655440050";

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
  error: jest.fn((res, message, statusCode, _details) => {
    res.status(statusCode).json({
      success: false,
      status: statusCode,
      message,
      data: null,
    });
  }),
}));

const certificatePdfController = require("../../controllers/certificatePdf.controller");
const certificatePdfService = require("../../services/certificatePdf.service");
const certificateDocumentService = require("../../services/certificateDocument.service");

describe("certificatePdf Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
      body: {},
      query: {},
      user: { tenantId: "tenant-1" },
      // A-293: the verification controller counts a minimal verdict per address.
      ip: "127.0.0.1",
      protocol: "https",
      get: jest.fn(() => "example.com"),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      download: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getDocument (M-11)", () => {
    it("answers the document in the envelope, for the caller's own tenant", async () => {
      req.params = { certificateId: CERT_ID };
      const doc = { certificateNumber: "CERT-001", integrity: { hash: "h" } };
      certificateDocumentService.getCertificateDocument.mockResolvedValue({ success: true, status: 200, data: doc });
      await certificatePdfController.getDocument(req, res, next);
      expect(certificateDocumentService.getCertificateDocument).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
        { baseUrl: expect.any(String) },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: doc, message: "Certificate document" });
    });

    it("answers 400 for a certificate id that is not a uuid, and reads nothing", async () => {
      req.params = { certificateId: "cert-1" };
      await certificatePdfController.getDocument(req, res, next);
      expect(certificateDocumentService.getCertificateDocument).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "certificateId", message: "Invalid GUID" }],
      });
    });

    it("answers the service's 404 (missing, deleted and another tenant's are the same)", async () => {
      req.params = { certificateId: CERT_ID };
      certificateDocumentService.getCertificateDocument.mockResolvedValue({
        success: false,
        status: 404,
        message: "Certificate not found",
      });
      await certificatePdfController.getDocument(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: "Certificate not found" }),
      );
    });
  });

  describe("downloadPdf (a PDF stored before M-11)", () => {
    it("should download the stored PDF", async () => {
      req.params = { certificateId: CERT_ID };
      certificatePdfService.getStoredPdf.mockResolvedValue({ success: true, data: { absPath: "/path/file.pdf", fileName: "file.pdf" } });
      await certificatePdfController.downloadPdf(req, res, next);
      expect(certificatePdfService.getStoredPdf).toHaveBeenCalledWith("tenant-1", CERT_ID);
      expect(res.download).toHaveBeenCalledWith("/path/file.pdf", "file.pdf");
    });

    it("answers the service's 404 when there is no stored PDF, and sends no file", async () => {
      req.params = { certificateId: CERT_ID };
      certificatePdfService.getStoredPdf.mockResolvedValue({ success: false, status: 404, message: "no stored PDF" });
      await certificatePdfController.downloadPdf(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.download).not.toHaveBeenCalled();
    });
  });

  describe("verifyCertificate", () => {
    it("should verify found certificate", async () => {
      req.params = { certificateNumber: "CERT-001" };
      certificatePdfService.verifyByCertificateNumber.mockResolvedValue({ data: { found: true } });
      await certificatePdfController.verifyCertificate(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should handle not found", async () => {
      req.params = { certificateNumber: "CERT-999" };
      certificatePdfService.verifyByCertificateNumber.mockResolvedValue({ data: { found: false } });
      await certificatePdfController.verifyCertificate(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });
});
describe("certificatePdf Controller — document frame-ancestors (ADR-042 step 4)", () => {
  const saved = process.env.CORS_ORIGIN;
  afterEach(() => {
    if (saved === undefined) {delete process.env.CORS_ORIGIN;}
    else {process.env.CORS_ORIGIN = saved;}
  });

  it("is just 'self' when no frontend origin is configured", () => {
    delete process.env.CORS_ORIGIN;
    expect(certificatePdfController._documentFrameAncestors()).toBe("'self'");
  });

  it("admits only well-formed http(s) origins, so CORS_ORIGIN cannot inject a directive", () => {
    process.env.CORS_ORIGIN = "https://a.test, http://b.test:3000, https://c.test; script-src *, javascript:x";
    expect(certificatePdfController._documentFrameAncestors()).toBe(
      "'self' https://a.test http://b.test:3000",
    );
  });
});
