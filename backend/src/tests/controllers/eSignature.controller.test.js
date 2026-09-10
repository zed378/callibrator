jest.mock("../../services/eSignature.service", () => ({
  getKeyPairs: jest.fn(),
  generateKeyPair: jest.fn(),
  deleteKeyPair: jest.fn(),
  getWorkflows: jest.fn(),
  createSignatureWorkflow: jest.fn(),
  getWorkflow: jest.fn(),
  updateWorkflow: jest.fn(),
  deleteWorkflow: jest.fn(),
  signDocument: jest.fn(),
  verifySignature: jest.fn(),
  getSignatureHistory: jest.fn(),
  cancelWorkflow: jest.fn(),
  revokeSignature: jest.fn(),
  getStatus: jest.fn(() => ({ enabled: true, algorithm: "RSA" })),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const eSignatureController = require("../../controllers/eSignature.controller");
const eSignatureService = require("../../services/eSignature.service");
const { success } = require("../../utils/response.util");

describe("eSignature Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mirrors the REAL success(res, data, metaOrMessage, messageOrStatusCode,
    // statusCode) from response.util.js. The previous mock invented a
    // (res, data, status, message) overload that does not exist, which made
    // `success(res, x, 201, "msg")` look like a 201 — hiding that 201 was
    // actually landing in `meta` while the response stayed HTTP 200.
    success.mockImplementation(
      (res, data = null, metaOrMessage = null, messageOrStatusCode = null, statusCode = 200) => {
        let message = "success";
        let status = 200;
        if (typeof metaOrMessage === "string") {
          message = metaOrMessage;
          status = typeof messageOrStatusCode === "number" ? messageOrStatusCode : statusCode;
        } else {
          message = typeof messageOrStatusCode === "string" ? messageOrStatusCode : "success";
          status = statusCode;
        }
        res.status(status).json({ success: true, status, message, data });
      },
    );
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: "user-1", tenantId: "tenant-1" },
      get: jest.fn().mockReturnValue(undefined),
    };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
  });

  describe("getKeyPairs", () => {
    it("should return key pairs", async () => {
      eSignatureService.getKeyPairs.mockResolvedValue([]);
      await eSignatureController.getKeyPairs(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("createKeyPair", () => {
    it("should create key pair", async () => {
      eSignatureService.generateKeyPair.mockResolvedValue({ publicKey: "key" });
      await eSignatureController.createKeyPair(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("deleteKeyPair", () => {
    it("should delete key pair", async () => {
      req.params = { keyPairId: "kp-1" };
      eSignatureService.deleteKeyPair.mockResolvedValue(true);
      await eSignatureController.deleteKeyPair(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("getWorkflows", () => {
    it("should return workflows", async () => {
      eSignatureService.getWorkflows.mockResolvedValue([]);
      await eSignatureController.getWorkflows(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
    it("should filter by status", async () => {
      req.query = { status: "active" };
      eSignatureService.getWorkflows.mockResolvedValue([]);
      await eSignatureController.getWorkflows(req, res, next);
      expect(eSignatureService.getWorkflows).toHaveBeenCalledWith("tenant-1", { status: "active" });
    });
  });

  describe("createWorkflow", () => {
    it("should create workflow", async () => {
      req.body = { documentId: "doc-1", signers: [], subject: "test" };
      eSignatureService.createSignatureWorkflow.mockResolvedValue({ id: "wf-1" });
      await eSignatureController.createWorkflow(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe("getWorkflow", () => {
    it("should return workflow", async () => {
      req.params = { workflowId: "wf-1" };
      eSignatureService.getWorkflow.mockResolvedValue({ id: "wf-1" });
      await eSignatureController.getWorkflow(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("updateWorkflow", () => {
    it("should update workflow", async () => {
      req.params = { workflowId: "wf-1" };
      req.body = { subject: "updated" };
      eSignatureService.updateWorkflow.mockResolvedValue({ id: "wf-1" });
      await eSignatureController.updateWorkflow(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("deleteWorkflow", () => {
    it("should delete workflow", async () => {
      req.params = { workflowId: "wf-1" };
      eSignatureService.deleteWorkflow.mockResolvedValue(true);
      await eSignatureController.deleteWorkflow(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("signDocument", () => {
    // stepId arrives in the (already validated) body — POST /sign has no path
    // param, so req.params.stepId was always undefined here.
    it("should sign the step named in the body, as the authenticated user", async () => {
      req.body = { stepId: "step-1", authenticationMethod: "mfa" };
      eSignatureService.signDocument.mockResolvedValue({ signatureId: "sig-1" });

      await eSignatureController.signDocument(req, res, next);

      expect(eSignatureService.signDocument).toHaveBeenCalledWith(
        "step-1",
        // req.user.id — NOT req.user.userId, which does not exist.
        "user-1",
        expect.objectContaining({ authenticationMethod: "mfa" }),
      );
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("should fall back to the connection ip/user-agent for the audit trail", async () => {
      req.body = { stepId: "step-1" };
      req.ip = "203.0.113.9";
      req.get = jest.fn().mockReturnValue("Mozilla/5.0");
      eSignatureService.signDocument.mockResolvedValue({ signatureId: "sig-1" });

      await eSignatureController.signDocument(req, res, next);

      expect(eSignatureService.signDocument).toHaveBeenCalledWith(
        "step-1",
        "user-1",
        expect.objectContaining({
          ipAddress: "203.0.113.9",
          userAgent: "Mozilla/5.0",
        }),
      );
    });

    it("should prefer an explicitly supplied ip/user-agent", async () => {
      req.body = {
        stepId: "step-1",
        ipAddress: "198.51.100.4",
        userAgent: "Custom/1.0",
      };
      req.ip = "203.0.113.9";
      req.get = jest.fn().mockReturnValue("Mozilla/5.0");
      eSignatureService.signDocument.mockResolvedValue({ signatureId: "sig-1" });

      await eSignatureController.signDocument(req, res, next);

      expect(eSignatureService.signDocument).toHaveBeenCalledWith(
        "step-1",
        "user-1",
        expect.objectContaining({
          ipAddress: "198.51.100.4",
          userAgent: "Custom/1.0",
        }),
      );
    });
  });

  describe("verifySignature", () => {
    // signatureId arrives in the body — POST /verify has no path param.
    it("should verify the signature named in the body", async () => {
      req.body = { signatureId: "sig-1" };
      eSignatureService.verifySignature.mockResolvedValue({ valid: true });

      await eSignatureController.verifySignature(req, res, next);

      expect(eSignatureService.verifySignature).toHaveBeenCalledWith("sig-1");
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("getSignatureHistory", () => {
    it("should return history", async () => {
      req.query = { userId: "user-1" };
      eSignatureService.getSignatureHistory.mockResolvedValue([]);
      await eSignatureController.getSignatureHistory(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("cancelWorkflow", () => {
    it("should cancel workflow", async () => {
      req.params = { workflowId: "wf-1" };
      eSignatureService.cancelWorkflow.mockResolvedValue(true);
      await eSignatureController.cancelWorkflow(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("revokeSignature", () => {
    it("should revoke signature", async () => {
      req.params = { signatureId: "sig-1" };
      req.body = { reason: "erroneous" };
      eSignatureService.revokeSignature.mockResolvedValue(true);
      await eSignatureController.revokeSignature(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("should return status", async () => {
      await eSignatureController.getStatus(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  // List endpoints normalise a null/undefined service result to an empty array
  // so the client always receives a list.
  describe("empty-list normalisation", () => {
    it("returns an empty keyPairs array when the service returns null", async () => {
      eSignatureService.getKeyPairs.mockResolvedValue(null);

      await eSignatureController.getKeyPairs(req, res, next);

      expect(eSignatureService.getKeyPairs).toHaveBeenCalledWith("tenant-1");
      expect(success).toHaveBeenCalledWith(res, { keyPairs: [] }, "Key pairs retrieved");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { keyPairs: [] } }),
      );
    });

    it("returns an empty workflows array when the service returns undefined", async () => {
      eSignatureService.getWorkflows.mockResolvedValue(undefined);
      req.query = { status: "pending" };

      await eSignatureController.getWorkflows(req, res, next);

      expect(eSignatureService.getWorkflows).toHaveBeenCalledWith("tenant-1", { status: "pending" });
      expect(success).toHaveBeenCalledWith(res, { workflows: [] }, "Workflows retrieved");
    });

    it("returns an empty signatures array when the history service returns null", async () => {
      eSignatureService.getSignatureHistory.mockResolvedValue(null);
      req.query = { userId: "user-9", startDate: "2026-01-01", endDate: "2026-06-30" };

      await eSignatureController.getSignatureHistory(req, res, next);

      expect(eSignatureService.getSignatureHistory).toHaveBeenCalledWith("tenant-1", {
        userId: "user-9",
        startDate: "2026-01-01",
        endDate: "2026-06-30",
      });
      expect(success).toHaveBeenCalledWith(res, { signatures: [] }, "Signature history retrieved");
    });

    it("passes the signature history through when the service returns rows", async () => {
      eSignatureService.getSignatureHistory.mockResolvedValue([{ id: "sig-1" }]);
      req.query = {};

      await eSignatureController.getSignatureHistory(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        { signatures: [{ id: "sig-1" }] },
        "Signature history retrieved",
      );
    });
  });
});