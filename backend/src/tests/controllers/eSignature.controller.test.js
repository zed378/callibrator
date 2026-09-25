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
  getEligibleSigners: jest.fn(),
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

    it("A-129: hands the service the actor for the CREATE audit row it writes in its transaction", async () => {
      req.body = { documentId: "doc-1", signers: [{ userId: "u-2" }], subject: "test" };
      req.ip = "203.0.113.9";
      eSignatureService.createSignatureWorkflow.mockResolvedValue({ workflowId: "wf-1" });

      await eSignatureController.createWorkflow(req, res, next);

      expect(eSignatureService.createSignatureWorkflow).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ documentId: "doc-1", signers: [{ userId: "u-2" }] }),
        expect.objectContaining({ userId: "user-1", ipAddress: "203.0.113.9" }),
      );
    });
  });

  describe("getEligibleSigners (A-129)", () => {
    it("sends the rows as data with meta.total beside them", async () => {
      const rows = [{ id: "u-2", name: "Ana Tech", email: "ana@example.com" }];
      eSignatureService.getEligibleSigners.mockResolvedValue(rows);

      await eSignatureController.getEligibleSigners(req, res, next);

      expect(eSignatureService.getEligibleSigners).toHaveBeenCalledWith("tenant-1");
      expect(success).toHaveBeenCalledWith(res, rows, { total: 1 }, "Eligible signers retrieved");
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

    it("should record the connection ip/user-agent, and pass the credential through", async () => {
      req.body = { stepId: "step-1", authPayload: "pw", reason: "Reviewed" };
      req.ip = "203.0.113.9";
      req.get = jest.fn().mockReturnValue("Mozilla/5.0");
      eSignatureService.signDocument.mockResolvedValue({ signatureId: "sig-1" });

      await eSignatureController.signDocument(req, res, next);

      expect(req.get).toHaveBeenCalledWith("user-agent");
      expect(eSignatureService.signDocument).toHaveBeenCalledWith(
        "step-1",
        "user-1",
        expect.objectContaining({
          ipAddress: "203.0.113.9",
          userAgent: "Mozilla/5.0",
          authPayload: "pw",
          reason: "Reviewed",
        }),
      );
    });

    it("should ignore a body ip/user-agent — the connection's are the only source (A-65)", async () => {
      req.body = {
        stepId: "step-1",
        authPayload: "pw",
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
          ipAddress: "203.0.113.9",
          userAgent: "Mozilla/5.0",
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

    it("A-130: passes the optional reason for the audit row, and tolerates an absent body", async () => {
      req.params = { workflowId: "wf-1" };
      req.body = { reason: "superseded" };
      eSignatureService.cancelWorkflow.mockResolvedValue({ success: true });

      await eSignatureController.cancelWorkflow(req, res, next);

      expect(eSignatureService.cancelWorkflow).toHaveBeenCalledWith(
        "wf-1",
        "user-1",
        "tenant-1",
        expect.objectContaining({ userId: "user-1" }),
        "superseded",
      );

      req.body = undefined;
      await eSignatureController.cancelWorkflow(req, res, next);
      expect(eSignatureService.cancelWorkflow).toHaveBeenLastCalledWith(
        "wf-1",
        "user-1",
        "tenant-1",
        expect.any(Object),
        undefined,
      );
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
    // A-113 — rows are `data` itself, the count in a top-level `meta`; it
    // used to be `data.keyPairs`.
    it("returns an empty key-pair list as data: [] with meta.total 0 when the service returns null", async () => {
      eSignatureService.getKeyPairs.mockResolvedValue(null);

      await eSignatureController.getKeyPairs(req, res, next);

      expect(eSignatureService.getKeyPairs).toHaveBeenCalledWith("tenant-1");
      // The wire shape is pinned against the real response.util in
      // eSignature.a113.test.js.
      expect(success).toHaveBeenCalledWith(res, [], { total: 0 }, "Key pairs retrieved");
    });

    // A-106 — rows are `data` itself with the count in a top-level meta; the
    // wire shape is pinned against the real response.util in
    // eSignature.envelope.a106.test.js.
    it("sends the workflow rows as data with meta.total beside them", async () => {
      eSignatureService.getWorkflows.mockResolvedValue([]);
      req.query = { status: "pending" };

      await eSignatureController.getWorkflows(req, res, next);

      expect(eSignatureService.getWorkflows).toHaveBeenCalledWith("tenant-1", { status: "pending" });
      expect(success).toHaveBeenCalledWith(res, [], { total: 0 }, "Workflows retrieved");
    });

    it("sends the signature history rows as data with the page's meta beside them", async () => {
      eSignatureService.getSignatureHistory.mockResolvedValue({ rows: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } });
      req.query = { userId: "user-9", startDate: "2026-01-01", endDate: "2026-06-30", page: "2", limit: "10" };

      await eSignatureController.getSignatureHistory(req, res, next);

      // A-129 (F-9): a caller with no `qms` read (this principal has no role
      // at all) is scoped to their own signatures by the service.
      expect(eSignatureService.getSignatureHistory).toHaveBeenCalledWith(
        "tenant-1",
        { userId: "user-9", startDate: "2026-01-01", endDate: "2026-06-30", page: "2", limit: "10" },
        { callerId: "user-1", canManage: false },
      );
      // D-24 (ADR-070): rows in data, the service's pagination as the top-level meta.
      expect(success).toHaveBeenCalledWith(
        res,
        [],
        { total: 0, page: 1, limit: 25, totalPages: 0 },
        "Signature history retrieved",
      );
    });

    it("A-129: a caller holding `qms` (here through the SUPERADMIN bypass) gets the tenant-wide scope", async () => {
      eSignatureService.getSignatureHistory.mockResolvedValue({ rows: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } });
      req.user = { id: "user-1", tenantId: "tenant-1", role: { id: "r", name: "SUPERADMIN" } };
      req.query = { userId: "user-9" };

      await eSignatureController.getSignatureHistory(req, res, next);

      expect(eSignatureService.getSignatureHistory).toHaveBeenCalledWith(
        "tenant-1",
        { userId: "user-9", startDate: undefined, endDate: undefined, page: undefined, limit: undefined },
        { callerId: "user-1", canManage: true },
      );
    });

    it("passes the signature history through when the service returns rows", async () => {
      eSignatureService.getSignatureHistory.mockResolvedValue({
        rows: [{ id: "sig-1" }],
        meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
      });
      req.query = {};

      await eSignatureController.getSignatureHistory(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: "sig-1" }],
        { total: 1, page: 1, limit: 25, totalPages: 1 },
        "Signature history retrieved",
      );
    });
  });
});