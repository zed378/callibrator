/**
 * Tests for Certificate Controller
 */

jest.mock("../../services/certificate.service", () => ({
  fetchCertificates: jest.fn(),
  fetchSpecificCertificate: jest.fn(),
  createCertificate: jest.fn(),
  updateCertificate: jest.fn(),
  deleteCertificate: jest.fn(),
  approveCertificate: jest.fn(),
  submitCertificateForApproval: jest.fn(),
  signCertificate: jest.fn(),
  revokeCertificate: jest.fn(),
  getCertificateStats: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../validators/certificate.validator", () => {
  const Joi = require("joi");
  return {
    getCertificatesQuery: Joi.object(),
    certificateIdSchema: Joi.object(),
    createCertificateSchema: Joi.object(),
    updateCertificateSchema: Joi.object(),
    approveCertificateSchema: Joi.object(),
    signCertificateSchema: Joi.object(),
    revokeCertificateSchema: Joi.object(),
    validate: jest.fn((data, schema) => {
      if (data.failValidation) {
        throw new Error("Validation failed");
      }
      return data;
    }),
  };
});

const certificateController = require("../../controllers/certificate.controller");
const certificateService = require("../../services/certificate.service");
const { success, error } = require("../../utils/response.util");

describe("certificateController", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      user: { id: "user-1", tenantId: "tenant-1" },
      query: {},
      params: {},
      body: {},
      headers: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response, data, meta, message, status) => {
      response.status(status || 200).json({ success: true, data, meta, message });
    });
    error.mockImplementation((response, message, status) => {
      response.status(status || 500).json({ success: false, message });
    });
  });

  describe("getAllCertificates", () => {
    it("should fetch all certificates successfully", async () => {
      certificateService.fetchCertificates.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { rows: [{ id: "c-1" }], meta: { total: 1 } },
      });

      await certificateController.getAllCertificates(req, res);

      expect(certificateService.fetchCertificates).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1" }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should call error response when validation fails", async () => {
      req.query = { failValidation: true };

      await certificateController.getAllCertificates(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getSpecificCertificate", () => {
    it("should fetch specific certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      certificateService.fetchSpecificCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.getSpecificCertificate(req, res);

      expect(certificateService.fetchSpecificCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createCertificate", () => {
    it("should create certificate successfully", async () => {
      req.body = { summary: "New cert" };
      certificateService.createCertificate.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.createCertificate(req, res);

      expect(certificateService.createCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "user-1",
        { summary: "New cert" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateCertificate", () => {
    it("should update certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      req.body = { summary: "Updated summary" };
      certificateService.updateCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.updateCertificate(req, res);

      expect(certificateService.updateCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
        expect.objectContaining({
          summary: "Updated summary",
          updatedBy: "user-1",
        }),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteCertificate", () => {
    it("should delete certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      certificateService.deleteCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: null,
      });

      await certificateController.deleteCertificate(req, res);

      expect(certificateService.deleteCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("submitCertificate", () => {
    it("should submit certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      certificateService.submitCertificateForApproval.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.submitCertificate(req, res);

      expect(certificateService.submitCertificateForApproval).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("approveCertificate", () => {
    it("should approve certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      req.body = { approvedBy: "approver-1" };
      certificateService.approveCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.approveCertificate(req, res);

      expect(certificateService.approveCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
        "approver-1",
        expect.any(Object),
      );
      expect(success).toHaveBeenCalled();
    });

    it("defaults approvedBy to the authenticated user when the body omits it", async () => {
      req.params = { certificateId: "c-1" };
      req.body = { authMethod: "password", meaning: "approval" };
      certificateService.approveCertificate.mockResolvedValue({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.approveCertificate(req, res);

      expect(certificateService.approveCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
        req.user.id,
        expect.objectContaining({ authMethod: "password", meaning: "approval" }),
      );
    });
  });

  describe("signCertificate", () => {
    it("should sign certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      req.body = { digitalSignature: "sig", digitalSignatureKeyId: "key-1" };
      certificateService.signCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.signCertificate(req, res);

      expect(certificateService.signCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
        "sig",
        "key-1",
        "user-1",
        expect.any(Object),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("revokeCertificate", () => {
    it("should revoke certificate successfully", async () => {
      req.params = { certificateId: "c-1" };
      req.body = { reason: "Device defect" };
      certificateService.revokeCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.revokeCertificate(req, res);

      expect(certificateService.revokeCertificate).toHaveBeenCalledWith(
        "tenant-1",
        "c-1",
        "Device defect",
        "user-1",
        expect.any(Object),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getCertificateStats", () => {
    it("should fetch statistics successfully", async () => {
      certificateService.getCertificateStats.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { totalCertificates: 10 },
      });

      await certificateController.getCertificateStats(req, res);

      expect(certificateService.getCertificateStats).toHaveBeenCalledWith("tenant-1");
      expect(success).toHaveBeenCalled();
    });
  });
});
