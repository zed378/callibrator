// eslint-disable-next-line no-undef

const {
  generateKeyPair,
  signDocument,
  verifySignature,
  getWorkflow,
  cancelWorkflow,
  revokeSignature,
  getStatus,
  SIGNATURE_STATUS,
  WORKFLOW_STATUS,
} = require("../../services/eSignature.service");

describe("eSignature.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ESIGN_ENABLED;
    delete process.env.REQUIRE_REAUTHENTICATION;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("generateKeyPair", () => {
    it("should throw error when e-signature is disabled", async () => {
      process.env.ESIGN_ENABLED = "false";
      jest.resetModules();
      const {
        generateKeyPair: gkp,
      } = require("../../services/eSignature.service");

      await expect(gkp("tenant-1")).rejects.toThrow("E-signature is disabled");
    });

    it("should generate key pair and return result", async () => {
      const mockCreate = jest.fn().mockResolvedValue({ id: "tk-1" });
      const mockTenantKey = { create: mockCreate };
      const mockModels = { TenantKey: mockTenantKey };

      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const mockGkp = jest.fn((type, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        cb(null, "mock-public-key", "mock-private-key");
      });
      mockGkp[Symbol.for("nodejs.util.promisify.custom")] = jest.fn().mockResolvedValue({
        publicKey: "mock-public-key",
        privateKey: "mock-private-key",
      });
      const spy = jest.spyOn(require("crypto"), "generateKeyPair").mockImplementation(mockGkp);
      spy[Symbol.for("nodejs.util.promisify.custom")] = jest.fn().mockResolvedValue({
        publicKey: "mock-public-key",
        privateKey: "mock-private-key",
      });

      const {
        generateKeyPair: gkp2,
      } = require("../../services/eSignature.service");
      const result = await gkp2("tenant-1");

      expect(result.keyId).toBeDefined();
      expect(result.publicKey).toBeDefined();
      expect(result.privateKey).toBe("[REDACTED]");
    });

    it("should throw error on generation failure", async () => {
      jest.resetModules();
      jest.spyOn(require("crypto"), "generateKeyPair").mockImplementation((type, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        cb(new Error("Crypto error"));
      });

      const {
        generateKeyPair: gkp3,
      } = require("../../services/eSignature.service");
      await expect(gkp3("tenant-1")).rejects.toThrow(
        "Failed to generate key pair",
      );
    });
  });

  describe("createSignatureWorkflow", () => {
    it("should throw error when e-signature is disabled", async () => {
      jest.resetModules();
      process.env.ESIGN_ENABLED = "false";
      const {
        createSignatureWorkflow: csw,
      } = require("../../services/eSignature.service");

      await expect(csw("tenant-1", {})).rejects.toThrow(
        "E-signature is disabled",
      );
    });

    it("should throw error when documentId or signers missing", async () => {
      jest.resetModules();
      const {
        createSignatureWorkflow: csw2,
      } = require("../../services/eSignature.service");

      await expect(csw2("tenant-1", {})).rejects.toThrow(
        "documentId and signers are required",
      );
      await expect(csw2("tenant-1", { documentId: "doc-1" })).rejects.toThrow(
        "documentId and signers are required",
      );
      await expect(
        csw2("tenant-1", { documentId: "doc-1", signers: [] }),
      ).rejects.toThrow("documentId and signers are required");
    });

    it("should create workflow with signers", async () => {
      const mockCreate = jest
        .fn()
        .mockResolvedValue({ id: "wf-1", status: "pending" });
      const mockWorkflow = { create: mockCreate };
      const mockStepCreate = jest.fn().mockResolvedValue({ id: "step-1" });
      const mockStep = { create: mockStepCreate };
      const mockModels = {
        SignatureWorkflow: mockWorkflow,
        SignatureWorkflowStep: mockStep,
      };

      jest.doMock("../../models", () => mockModels);
      jest.doMock("../../services/emailQueue.service", () => ({
        emailQueueService: {
          queueEmail: jest.fn().mockResolvedValue(undefined),
        },
      }));

      jest.resetModules();
      const {
        createSignatureWorkflow: csw3,
      } = require("../../services/eSignature.service");

      const result = await csw3("tenant-1", {
        documentId: "doc-1",
        signers: [{ userId: "u-1", email: "a@b.com", name: "A" }],
      });

      expect(result.workflowId).toBeDefined();
      expect(result.signers).toHaveLength(1);
    });
  });

  describe("signDocument", () => {
    it("should sign document and return signature", async () => {
      const mockStep = {
        findByPk: jest.fn().mockResolvedValue({
          id: "step-1",
          status: "pending",
          workflowId: "wf-1",
          tenantId: "tenant-1",
          stepNumber: 1,
          update: jest.fn().mockResolvedValue(true),
        }),
        findAll: jest.fn().mockResolvedValue([]),
      };
      const mockWorkflow = {
        findByPk: jest.fn().mockResolvedValue({
          id: "wf-1",
          documentId: "doc-1",
          tenantId: "tenant-1",
          update: jest.fn().mockResolvedValue(true),
        }),
        findAll: jest.fn().mockResolvedValue([]),
      };
      const mockSigRecord = {
        create: jest.fn().mockResolvedValue({
          id: "sig-1",
          signedAt: new Date(),
        }),
      };
      const mockAuditLog = { create: jest.fn().mockResolvedValue(true) };
      const mockModels = {
        SignatureWorkflowStep: mockStep,
        SignatureWorkflow: mockWorkflow,
        SignatureRecord: mockSigRecord,
        AuditLog: mockAuditLog,
        User: {
          findByPk: jest
            .fn()
            .mockResolvedValue({ id: "u-1", status: "active" }),
        },
      };

      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        signDocument: sd,
      } = require("../../services/eSignature.service");

      const result = await sd("step-1", "u-1", {
        polygon: { x: 10, y: 20 },
        authenticationMethod: "password",
      });

      expect(result.signatureId).toBeDefined();
      expect(result.certificate).toBeDefined();
    });
  });

  describe("verifySignature", () => {
    it("should return valid false when signature not found", async () => {
      const mockSigRecord = { findByPk: jest.fn().mockResolvedValue(null) };
      const mockModels = { SignatureRecord: mockSigRecord };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        verifySignature: vs,
      } = require("../../services/eSignature.service");

      const result = await vs("nonexistent");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature not found");
    });

    it("should return valid false when signature is revoked", async () => {
      const mockSigRecord = {
        findByPk: jest.fn().mockResolvedValue({
          id: "sig-1",
          status: "revoked",
          workflowId: "wf-1",
          userId: "u-1",
          tenantId: "tenant-1",
          signatureHash: "hash-1",
          signedAt: new Date(),
          signatureAlgorithm: "RS256",
          ipAddress: "127.0.0.1",
          userAgent: "test",
          authenticationMethod: "password",
          polygon: null,
          biometricData: null,
        }),
      };
      const mockWorkflow = {
        findByPk: jest.fn().mockResolvedValue({
          id: "wf-1",
          documentId: "doc-1",
        }),
      };
      const mockModels = {
        SignatureRecord: mockSigRecord,
        SignatureWorkflow: mockWorkflow,
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        verifySignature: vs2,
      } = require("../../services/eSignature.service");

      const result = await vs2("sig-1");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature has been revoked");
    });
  });

  describe("getWorkflow", () => {
    it("should return workflow with steps", async () => {
      const mockWorkflow = {
        findByPk: jest.fn().mockResolvedValue({
          id: "wf-1",
          steps: [{ id: "step-1", stepNumber: 1 }],
        }),
      };
      const mockModels = {
        SignatureWorkflow: mockWorkflow,
        SignatureWorkflowStep: {},
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        getWorkflow: gw,
      } = require("../../services/eSignature.service");

      const result = await gw("wf-1");

      expect(result).not.toBeNull();
    });

    it("should return null when workflow not found", async () => {
      const mockWorkflow = { findByPk: jest.fn().mockResolvedValue(null) };
      const mockModels = { SignatureWorkflow: mockWorkflow };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        getWorkflow: gw2,
      } = require("../../services/eSignature.service");

      const result = await gw2("not-found");

      expect(result).toBeNull();
    });
  });

  describe("cancelWorkflow", () => {
    it("should throw error when workflow not found", async () => {
      const mockWorkflow = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const mockModels = { SignatureWorkflow: mockWorkflow };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        cancelWorkflow: cw,
      } = require("../../services/eSignature.service");

      await expect(cw("wf-1", "u-1", "tenant-1")).rejects.toThrow(
        "Workflow not found",
      );
    });

    it("should throw error when workflow is completed", async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockWorkflow = {
        findOne: jest.fn().mockResolvedValue({
          status: "completed",
          update: mockUpdate,
        }),
      };
      const mockModels = { SignatureWorkflow: mockWorkflow };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        cancelWorkflow: cw2,
      } = require("../../services/eSignature.service");

      await expect(cw2("wf-1", "u-1", "tenant-1")).rejects.toThrow(
        "Cannot cancel completed workflow",
      );
    });

    it("should cancel pending workflow", async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockWorkflow = {
        findOne: jest.fn().mockResolvedValue({
          status: "pending",
          update: mockUpdate,
        }),
      };
      const mockModels = { SignatureWorkflow: mockWorkflow };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        cancelWorkflow: cw3,
      } = require("../../services/eSignature.service");

      const result = await cw3("wf-1", "u-1", "tenant-1");

      expect(result.success).toBe(true);
    });
  });

  describe("revokeSignature", () => {
    it("should throw error when signature not found", async () => {
      const mockSigRecord = { findOne: jest.fn().mockResolvedValue(null) };
      const mockAuditLog = { create: jest.fn().mockResolvedValue(true) };
      const mockModels = {
        SignatureRecord: mockSigRecord,
        AuditLog: mockAuditLog,
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        revokeSignature: rs,
      } = require("../../services/eSignature.service");

      await expect(
        rs("sig-1", "u-1", "tenant-1", "wrong signature"),
      ).rejects.toThrow("Signature not found");
    });

    it("should revoke signature with reason", async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockSigRecord = {
        findOne: jest.fn().mockResolvedValue({
          status: "signed",
          update: mockUpdate,
        }),
      };
      const mockAuditLog = { create: jest.fn().mockResolvedValue(true) };
      const mockModels = {
        SignatureRecord: mockSigRecord,
        AuditLog: mockAuditLog,
      };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        revokeSignature: rs2,
      } = require("../../services/eSignature.service");

      const result = await rs2(
        "sig-1",
        "u-1",
        "tenant-1",
        "duplicate signature",
      );

      expect(result.success).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return service status", () => {
      const result = getStatus();

      expect(result.enabled).toBe(true);
      expect(result.algorithm).toBe("RS256");
      expect(result.keySize).toBe(2048);
      expect(result.reauthenticationRequired).toBe(true);
    });

    it("should reflect disabled state", () => {
      process.env.ESIGN_ENABLED = "false";
      jest.resetModules();
      const {
        getStatus: gs2,
      } = require("../../services/eSignature.service");

      const result = gs2();
      expect(result.enabled).toBe(false);
    });
  });

  describe("constants", () => {
    it("should have SIGNATURE_STATUS", () => {
      expect(SIGNATURE_STATUS.PENDING).toBe("pending");
      expect(SIGNATURE_STATUS.SIGNED).toBe("signed");
      expect(SIGNATURE_STATUS.REVOKED).toBe("revoked");
      expect(SIGNATURE_STATUS.EXPIRED).toBe("expired");
    });

    it("should have WORKFLOW_STATUS", () => {
      expect(WORKFLOW_STATUS.PENDING).toBe("pending");
      expect(WORKFLOW_STATUS.IN_PROGRESS).toBe("in_progress");
      expect(WORKFLOW_STATUS.COMPLETED).toBe("completed");
      expect(WORKFLOW_STATUS.CANCELLED).toBe("cancelled");
      expect(WORKFLOW_STATUS.EXPIRED).toBe("expired");
    });
  });
});
