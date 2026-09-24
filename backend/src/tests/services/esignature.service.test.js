// A-41: signing and revocation run in a managed transaction. The callback runs
// with a sentinel; the in-transaction effects are asserted against a
// schema-enforcing ledger in esignature.audit.a41.test.js.
// This file also loads the real models barrel, so keep the real config and
// replace only the transaction runner.
jest.mock("../../config", () => {
  const actual = jest.requireActual("../../config");
  actual.db.transaction = async (cb) => cb("TX");
  return actual;
});

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
const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

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
        // A-129 — the signer is read from the user row, in the tenant.
        User: {
          findOne: jest.fn().mockResolvedValue({
            id: "u-1",
            email: "a@b.com",
            firstName: "A",
            lastName: "B",
            isActive: true,
            status: "ACTIVE",
            roleId: "r-1",
          }),
        },
        Role: { findByPk: jest.fn().mockResolvedValue({ id: "r-1", name: "TECHNICIAN" }) },
        AuditLog: { create: jest.fn().mockResolvedValue(true) },
      };

      jest.doMock("../../models", () => mockModels);
      jest.doMock("../../middlewares/dynamicAccess.middleware", () => ({
        principalHasMenuPermission: jest.fn().mockResolvedValue(true),
      }));
      jest.doMock("../../services/emailQueue.service", () => ({
        emailQueueService: {
          queueEmail: jest.fn().mockResolvedValue(undefined),
        },
      }));

      jest.resetModules();
      const {
        createSignatureWorkflow: csw3,
      } = require("../../services/eSignature.service");

      const result = await csw3(
        "tenant-1",
        { documentId: "doc-1", signers: [{ userId: "u-1", email: "a@b.com", name: "A" }] },
        { userId: "admin-1" },
      );

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
          signerId: "u-1",
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
      // Signing loads and decrypts the tenant's real key pair (ADR-040).
      const keyPair = generateTestKeyPair({ keyId: "key-svc-1" });
      const mockModels = {
        TenantKey: {
          unscoped: () => ({ findOne: jest.fn().mockResolvedValue(keyPair) }),
          findOne: jest.fn(),
        },
        SignatureWorkflowStep: mockStep,
        SignatureWorkflow: mockWorkflow,
        SignatureRecord: mockSigRecord,
        AuditLog: mockAuditLog,
        User: {
          findByPk: jest
            .fn()
            .mockResolvedValue({ id: "u-1", status: "ACTIVE", isActive: true }),
        },
      };

      jest.doMock("../../models", () => mockModels);
      // A-65 — signing re-authenticates the signer's password.
      jest.doMock("../../services/auth.service", () => ({
        passIsValid: async () => ({ data: { valid: true } }),
      }));

      jest.resetModules();
      const {
        signDocument: sd,
      } = require("../../services/eSignature.service");

      const result = await sd("step-1", "u-1", {
        polygon: { x: 10, y: 20 },
        authenticationMethod: "password",
        authPayload: "pw",
        reason: "Approved",
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
        findOne: jest.fn().mockResolvedValue({
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

      const result = await gw("wf-1", "tenant-1");

      expect(result).not.toBeNull();
      // A-105 — the tenant is explicit on the workflow AND its steps.
      expect(mockWorkflow.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "wf-1", tenantId: "tenant-1" },
          include: [
            expect.objectContaining({ where: { tenantId: "tenant-1" }, required: false }),
          ],
        }),
      );
    });

    it("should throw 404 when workflow not found", async () => {
      const mockWorkflow = { findOne: jest.fn().mockResolvedValue(null) };
      const mockModels = { SignatureWorkflow: mockWorkflow };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        getWorkflow: gw2,
      } = require("../../services/eSignature.service");

      await expect(gw2("not-found", "tenant-1")).rejects.toMatchObject({
        status: 404,
        message: "Workflow not found",
      });
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

      // A-92 — a state conflict: 409, explained, and nothing written.
      const err = await cw2("wf-1", "u-1", "tenant-1").catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.message).toBe(
        'This signature workflow is "completed" and cannot be cancelled: every signer has signed, ' +
          "and the signatures cover the workflow as it was signed.",
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should cancel pending workflow", async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockWorkflow = {
        findOne: jest.fn().mockResolvedValue({
          status: "pending",
          update: mockUpdate,
        }),
      };
      // A-104 — the cancellation writes its audit row (audit.service reads
      // AuditLog from the models barrel).
      const mockAuditLog = { create: jest.fn().mockResolvedValue({ id: "a-1" }) };
      const mockModels = { SignatureWorkflow: mockWorkflow, AuditLog: mockAuditLog };
      jest.doMock("../../models", () => mockModels);

      jest.resetModules();
      const {
        cancelWorkflow: cw3,
      } = require("../../services/eSignature.service");

      const result = await cw3("wf-1", "u-1", "tenant-1");

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({ status: "cancelled" }, { transaction: "TX" });
      expect(mockAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "UPDATE", resourceId: "wf-1", userId: "u-1" }),
        { transaction: "TX" },
      );
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
