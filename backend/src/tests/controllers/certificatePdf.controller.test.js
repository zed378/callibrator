jest.mock("../../services/certificatePdf.service", () => ({
  generateCertificatePdf: jest.fn(),
  getOrCreatePdf: jest.fn(),
  verifyByCertificateNumber: jest.fn(),
}));

jest.mock("../../validators/certificate.validator", () => ({
  certificateIdSchema: {},
  validate: jest.fn((data) => data),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
  error: jest.fn((res, message, statusCode, details) => {
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

describe("certificatePdf Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
      body: {},
      query: {},
      user: { tenantId: "tenant-1" },
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

  describe("generatePdf", () => {
    it("should generate PDF", async () => {
      req.params = { certificateId: "cert-1" };
      certificatePdfService.generateCertificatePdf.mockResolvedValue({ success: true, data: { path: "/pdf" }, message: "Generated", status: 200 });
      await certificatePdfController.generatePdf(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it("should handle generation failure", async () => {
      req.params = { certificateId: "cert-1" };
      certificatePdfService.generateCertificatePdf.mockResolvedValue({ success: false, status: 404, message: "Certificate not found" });
      await certificatePdfController.generatePdf(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: "Certificate not found" }),
      );
    });

    it("defaults to 500 when the failed result carries no status", async () => {
      req.params = { certificateId: "cert-1" };
      certificatePdfService.generateCertificatePdf.mockResolvedValue({ success: false, message: "Renderer crashed" });
      await certificatePdfController.generatePdf(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: "Renderer crashed" }),
      );
    });
  });

  describe("downloadPdf", () => {
    it("should download PDF", async () => {
      req.params = { certificateId: "cert-1" };
      certificatePdfService.getOrCreatePdf.mockResolvedValue({ success: true, data: { absPath: "/path/file.pdf", fileName: "file.pdf" } });
      await certificatePdfController.downloadPdf(req, res, next);
      expect(res.download).toHaveBeenCalled();
    });

    it("should handle failure", async () => {
      req.params = { certificateId: "cert-1" };
      certificatePdfService.getOrCreatePdf.mockResolvedValue({ success: false, status: 403, message: "Forbidden" });
      await certificatePdfController.downloadPdf(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.download).not.toHaveBeenCalled();
    });

    it("defaults to 500 when the failed result carries no status", async () => {
      req.params = { certificateId: "cert-1" };
      certificatePdfService.getOrCreatePdf.mockResolvedValue({ success: false, message: "Disk full" });
      await certificatePdfController.downloadPdf(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: "Disk full" }),
      );
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