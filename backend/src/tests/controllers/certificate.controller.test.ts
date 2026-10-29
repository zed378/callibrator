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
  sendResult: jest.fn(),
}));

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user: { id: string; tenantId: string; [key: string]: unknown };
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
  locals: Record<string, unknown>;
}

interface ServiceResult {
  status: number;
  success: boolean;
  message: string;
  data: unknown;
}

interface CertificateServiceDouble {
  fetchCertificates: jest.Mock;
  fetchSpecificCertificate: jest.Mock;
  createCertificate: jest.Mock;
  updateCertificate: jest.Mock;
  deleteCertificate: jest.Mock;
  approveCertificate: jest.Mock;
  submitCertificateForApproval: jest.Mock;
  signCertificate: jest.Mock;
  revokeCertificate: jest.Mock;
  getCertificateStats: jest.Mock;
}

type ControllerHandler = (req: FakeReq, res: FakeRes) => Promise<void>;

interface CertificateControllerDouble {
  getAllCertificates: ControllerHandler;
  getSpecificCertificate: ControllerHandler;
  createCertificate: ControllerHandler;
  updateCertificate: ControllerHandler;
  deleteCertificate: ControllerHandler;
  submitCertificate: ControllerHandler;
  approveCertificate: ControllerHandler;
  signCertificate: ControllerHandler;
  revokeCertificate: ControllerHandler;
  getCertificateStats: ControllerHandler;
}

interface ResponseUtilDouble {
  success: jest.Mock;
  error: jest.Mock;
  sendResult: jest.Mock;
}

// The validator module is NOT mocked: every call goes through the real Zod
// schemas, so ids are real uuids and the re-authentication fields are sent.
const CERT_ID = "5a0e8400-e29b-41d4-a716-446655440030";
const DEVICE_ID = "5a0e8400-e29b-41d4-a716-446655440031";
const REAUTH = { authMethod: "password", authPayload: "secret", meaning: "approval" };

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const certificateController = require("../../controllers/certificate.controller") as CertificateControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const certificateService = require("../../services/certificate.service") as CertificateServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success, error, sendResult } = require("../../utils/response.util") as ResponseUtilDouble;

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String) as string, message: expect.any(String) as string }),
]) as unknown;

describe("certificateController", () => {
  let req: FakeReq;
  let res: FakeRes;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      user: { id: "user-1", tenantId: "tenant-1" },
      query: {},
      params: {},
      body: {},
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.9",
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response: FakeRes, data: unknown, meta: unknown, message: string, status?: number) => {
      (response.status(status ?? 200) as FakeRes).json({ success: true, data, meta, message });
    });
    error.mockImplementation((response: FakeRes, message: string, status?: number) => {
      (response.status(status ?? 500) as FakeRes).json({ success: false, message });
    });
    // The real routing rule is pinned against the real response.util in
    // certificate.controller.envelope.a103.test.js; here it routes onto the
    // doubles above so these tests can keep asserting on success/error.
    sendResult.mockImplementation((response: FakeRes, result: ServiceResult, meta: unknown = null): unknown =>
      result.status >= 400 || !result.success
        ? error(response, result.message, result.status)
        : success(response, result.data, meta, result.message, result.status),
    );
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
        expect.objectContaining({
          tenantId: "tenant-1",
          page: 1,
          sortBy: "created_at",
          sortOrder: "DESC",
        }),
      );
      // P21-09e (spec § 12): each row carries its people's displays (none here: no person ids).
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: "c-1", calibratedByDisplay: null, approvedByDisplay: null, signedByDisplay: null }],
        { total: 1 },
        "Success",
        200,
      );
    });

    it("should call error response when validation fails", async () => {
      req.query = { sortOrder: "sideways" };

      await certificateController.getAllCertificates(req, res);

      expect(certificateService.fetchCertificates).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });

  describe("getSpecificCertificate", () => {
    it("should fetch specific certificate successfully", async () => {
      req.params = { certificateId: CERT_ID };
      certificateService.fetchSpecificCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.getSpecificCertificate(req, res);

      expect(certificateService.fetchSpecificCertificate).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createCertificate", () => {
    it("should create certificate successfully", async () => {
      req.body = { deviceId: DEVICE_ID, summary: "New cert" };
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
        { deviceId: DEVICE_ID, type: "calibration", summary: "New cert" },
        // A-282: auditPrincipal(req)
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateCertificate", () => {
    it("should update certificate successfully", async () => {
      req.params = { certificateId: CERT_ID };
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
        CERT_ID,
        expect.objectContaining({
          summary: "Updated summary",
          updatedBy: "user-1",
        }),
        // A-282: auditPrincipal(req)
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteCertificate", () => {
    it("should delete certificate successfully", async () => {
      req.params = { certificateId: CERT_ID };
      certificateService.deleteCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: null,
      });

      await certificateController.deleteCertificate(req, res);

      expect(certificateService.deleteCertificate).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
        // A-282: auditPrincipal(req)
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("submitCertificate", () => {
    it("should submit certificate successfully", async () => {
      req.params = { certificateId: CERT_ID };
      certificateService.submitCertificateForApproval.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.submitCertificate(req, res);

      expect(certificateService.submitCertificateForApproval).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
        // A-282: auditPrincipal(req)
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("approveCertificate", () => {
    // A-62 — the body's approvedBy is ignored; the caller is the approver.
    it("should approve certificate successfully as the caller, ignoring a body approvedBy", async () => {
      req.params = { certificateId: CERT_ID };
      req.body = { approvedBy: "approver-1", ...REAUTH };
      certificateService.approveCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.approveCertificate(req, res);

      expect(certificateService.approveCertificate).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
        "user-1",
        { ...REAUTH, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });

    it("answers 400 and approves nothing without the re-authentication fields", async () => {
      req.params = { certificateId: CERT_ID };
      req.body = { approvedBy: "approver-1" };

      await certificateController.approveCertificate(req, res);

      expect(certificateService.approveCertificate).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });

    it("defaults approvedBy to the authenticated user when the body omits it", async () => {
      req.params = { certificateId: CERT_ID };
      req.body = { authMethod: "password", authPayload: "secret", meaning: "approval" };
      certificateService.approveCertificate.mockResolvedValue({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.approveCertificate(req, res);

      expect(certificateService.approveCertificate).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
        req.user.id,
        expect.objectContaining({ authMethod: "password", meaning: "approval" }),
      );
    });
  });

  describe("signCertificate", () => {
    it("should sign certificate successfully", async () => {
      req.params = { certificateId: CERT_ID };
      req.body = { digitalSignature: "sig", digitalSignatureKeyId: "key-1", ...REAUTH };
      certificateService.signCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.signCertificate(req, res);

      expect(certificateService.signCertificate).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
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
      req.params = { certificateId: CERT_ID };
      req.body = { reason: "Device defect", ...REAUTH };
      certificateService.revokeCertificate.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "c-1" },
      });

      await certificateController.revokeCertificate(req, res);

      expect(certificateService.revokeCertificate).toHaveBeenCalledWith(
        "tenant-1",
        CERT_ID,
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
