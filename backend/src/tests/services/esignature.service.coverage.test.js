/**
 * Guard/validation/error-branch coverage for eSignature.service.
 *
 * IMPORTANT — this module is a NON-FUNCTIONAL FACADE. It requires four models
 * that do not exist anywhere in src/models (TenantKey, SignatureWorkflow,
 * SignatureWorkflowStep, SignatureRecord — the real model is ESignatureRecord),
 * so in production every one of its routes 500s. These tests inject those model
 * names via jest.doMock purely to REACH the guard/validation/error branches.
 * Nothing here asserts that the module works end-to-end, and passing tests here
 * must not be read as evidence that it does.
 *
 * Deliberately NOT mocked: ../../services/emailQueue.service. The service does
 * `const { emailQueueService } = require("../services/emailQueue.service")`, but
 * that module exports no such key (see the notes on sendSignatureRequest below),
 * so the real module is loaded to exercise the real failure path.
 */

const ESIGN_PATH = "../../services/eSignature.service";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/**
 * Load a fresh copy of the service with `models` injected and `env` applied.
 * ESIGN_ENABLED / REQUIRE_REAUTHENTICATION are read once at module load, so the
 * env must be set before the require.
 */
const loadService = ({ models = {}, env = {} } = {}) => {
  jest.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  jest.doMock("../../models", () => models);
  jest.doMock("../../middlewares/activityLog.middleware", () => ({
    logger: mockLogger,
  }));
  return require(ESIGN_PATH);
};

describe("eSignature.service (facade guard/error branches)", () => {
  let envBackup;

  beforeEach(() => {
    jest.clearAllMocks();
    envBackup = {
      ESIGN_ENABLED: process.env.ESIGN_ENABLED,
      REQUIRE_REAUTHENTICATION: process.env.REQUIRE_REAUTHENTICATION,
    };
    delete process.env.ESIGN_ENABLED;
    delete process.env.REQUIRE_REAUTHENTICATION;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // ================================================================
  describe("generateKeyPair", () => {
    it("rethrows a persistence error that already carries a status", async () => {
      // The catch rethrows anything with `.status` rather than masking it as 500.
      const err = Object.assign(new Error("duplicate keyId"), { status: 409 });
      const TenantKey = { create: jest.fn().mockRejectedValue(err) };
      const svc = loadService({ models: { TenantKey } });

      await expect(svc.generateKeyPair("tenant-1")).rejects.toMatchObject({
        status: 409,
        message: "duplicate keyId",
      });
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("createSignatureWorkflow", () => {
    const buildModels = () => ({
      SignatureWorkflow: {
        create: jest.fn().mockResolvedValue({
          id: "wf-1",
          subject: "Sign me",
          expiresAt: new Date("2030-01-01"),
        }),
      },
      SignatureWorkflowStep: {
        create: jest.fn((attrs) => Promise.resolve({ id: `step-${attrs.stepNumber}`, ...attrs })),
      },
    });

    it("marks only the first signer pending and leaves the rest waiting", async () => {
      const models = buildModels();
      const svc = loadService({ models });

      const result = await svc.createSignatureWorkflow("tenant-1", {
        documentId: "doc-1",
        signers: [
          { userId: "u-1", email: "a@b.com", name: "A" },
          { userId: "u-2", email: "c@d.com", name: "C" },
        ],
      });

      expect(result.workflowId).toBe("wf-1");
      expect(models.SignatureWorkflowStep.create).toHaveBeenCalledTimes(2);
      expect(models.SignatureWorkflowStep.create.mock.calls[0][0]).toMatchObject({
        stepNumber: 1,
        status: "pending",
      });
      expect(models.SignatureWorkflowStep.create.mock.calls[1][0]).toMatchObject({
        stepNumber: 2,
        status: "waiting",
      });
    });

    it("applies default subject/message/expiry when they are omitted", async () => {
      const models = buildModels();
      const svc = loadService({ models });

      await svc.createSignatureWorkflow("tenant-1", {
        documentId: "doc-1",
        signers: [{ userId: "u-1", email: "a@b.com", name: "A" }],
      });

      expect(models.SignatureWorkflow.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Please sign this document",
          message: "",
          status: "pending",
        }),
      );
      expect(models.SignatureWorkflow.create.mock.calls[0][0].expiresAt).toBeInstanceOf(Date);
    });

    it("masks an unexpected persistence failure as a 500", async () => {
      const models = buildModels();
      models.SignatureWorkflow.create.mockRejectedValue(new Error("table missing"));
      const svc = loadService({ models });

      await expect(
        svc.createSignatureWorkflow("tenant-1", {
          documentId: "doc-1",
          signers: [{ userId: "u-1", email: "a@b.com", name: "A" }],
        }),
      ).rejects.toMatchObject({ status: 500, message: "Failed to create signature workflow" });
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to create signature workflow",
        { tenantId: "tenant-1", error: "table missing" },
      );
    });

    it("rethrows a persistence error that already carries a status", async () => {
      const models = buildModels();
      models.SignatureWorkflow.create.mockRejectedValue(
        Object.assign(new Error("nope"), { status: 403 }),
      );
      const svc = loadService({ models });

      await expect(
        svc.createSignatureWorkflow("tenant-1", {
          documentId: "doc-1",
          signers: [{ userId: "u-1", email: "a@b.com", name: "A" }],
        }),
      ).rejects.toMatchObject({ status: 403, message: "nope" });
    });

    it("swallows the (always-failing) signature-request notification", async () => {
      // sendSignatureRequest destructures `emailQueueService` from
      // emailQueue.service, which does not export it => TypeError on every call.
      // The try/catch means workflow creation still succeeds, silently.
      const models = buildModels();
      const svc = loadService({ models });

      const result = await svc.createSignatureWorkflow("tenant-1", {
        documentId: "doc-1",
        signers: [{ userId: "u-1", email: "a@b.com", name: "A" }],
      });

      expect(result.workflowId).toBe("wf-1");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to send signature request",
        expect.objectContaining({ workflowId: "wf-1" }),
      );
      // No "Signature request sent" info log: the send never actually happened.
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        "Signature request sent",
        expect.anything(),
      );
    });
  });

  // ================================================================
  describe("signDocument", () => {
    const activeUser = { findByPk: jest.fn().mockResolvedValue({ id: "u-1", status: "active" }) };

    it("404s when the step does not exist", async () => {
      const svc = loadService({
        models: { SignatureWorkflowStep: { findByPk: jest.fn().mockResolvedValue(null) } },
      });

      await expect(svc.signDocument("missing", "u-1", {})).rejects.toMatchObject({
        status: 404,
        message: "Signature step not found",
      });
    });

    it("400s when the step is not pending", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({ id: "step-1", status: "signed" }),
          },
        },
      });

      await expect(svc.signDocument("step-1", "u-1", {})).rejects.toMatchObject({
        status: 400,
        message: "Step is not pending (status: signed)",
      });
    });

    it("401s when the re-authenticated user is not active", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({ id: "step-1", status: "pending" }),
          },
          User: { findByPk: jest.fn().mockResolvedValue({ id: "u-1", status: "suspended" }) },
        },
        env: { REQUIRE_REAUTHENTICATION: "true" },
      });

      await expect(svc.signDocument("step-1", "u-1", {})).rejects.toMatchObject({
        status: 401,
        message: "Re-authentication required",
      });
    });

    it("401s when the re-authenticated user does not exist", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({ id: "step-1", status: "pending" }),
          },
          User: { findByPk: jest.fn().mockResolvedValue(null) },
        },
        env: { REQUIRE_REAUTHENTICATION: "true" },
      });

      await expect(svc.signDocument("step-1", "u-1", {})).rejects.toMatchObject({ status: 401 });
    });

    it("skips the re-authentication lookup when REQUIRE_REAUTHENTICATION=false", async () => {
      const User = { findByPk: jest.fn() };
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({ id: "step-1", status: "pending", workflowId: "wf-1" }),
          },
          SignatureWorkflow: { findByPk: jest.fn().mockResolvedValue(null) },
          User,
        },
        env: { REQUIRE_REAUTHENTICATION: "false" },
      });

      // Fails later (workflow missing), but the user lookup must not have run.
      await expect(svc.signDocument("step-1", "u-1", {})).rejects.toMatchObject({ status: 404 });
      expect(User.findByPk).not.toHaveBeenCalled();
    });

    it("404s when the parent workflow is missing", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({ id: "step-1", status: "pending", workflowId: "wf-1" }),
          },
          SignatureWorkflow: { findByPk: jest.fn().mockResolvedValue(null) },
          User: activeUser,
        },
      });

      await expect(svc.signDocument("step-1", "u-1", {})).rejects.toMatchObject({
        status: 404,
        message: "Workflow not found",
      });
    });

    it("defaults polygon/biometricData/authenticationMethod when the payload omits them", async () => {
      const signedAt = new Date();
      const SignatureRecord = { create: jest.fn().mockResolvedValue({ id: "sig-1", signedAt }) };
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({
              id: "step-1",
              status: "pending",
              workflowId: "wf-1",
              tenantId: "tenant-1",
              update: jest.fn().mockResolvedValue(true),
            }),
            findAll: jest.fn().mockResolvedValue([{ status: "signed" }]),
          },
          SignatureWorkflow: {
            findByPk: jest.fn().mockResolvedValue({
              id: "wf-1",
              documentId: "doc-1",
              tenantId: "tenant-1",
              update: jest.fn().mockResolvedValue(true),
            }),
          },
          SignatureRecord,
          AuditLog: { create: jest.fn().mockResolvedValue(true) },
          User: activeUser,
        },
      });

      await svc.signDocument("step-1", "u-1", {});

      expect(SignatureRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          polygon: null,
          biometricData: null,
          authenticationMethod: "password",
          ipAddress: null,
          userAgent: null,
          status: "signed",
        }),
      );
    });

    it("promotes the next waiting signer when signatures remain outstanding", async () => {
      const nextStep = { status: "waiting", signerEmail: "next@b.com", update: jest.fn().mockResolvedValue(true) };
      const workflow = {
        id: "wf-1",
        documentId: "doc-1",
        subject: "Sign me",
        tenantId: "tenant-1",
        update: jest.fn().mockResolvedValue(true),
      };
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({
              id: "step-1",
              status: "pending",
              workflowId: "wf-1",
              tenantId: "tenant-1",
              update: jest.fn().mockResolvedValue(true),
            }),
            findAll: jest.fn().mockResolvedValue([{ status: "signed" }, nextStep]),
          },
          SignatureWorkflow: { findByPk: jest.fn().mockResolvedValue(workflow) },
          SignatureRecord: {
            create: jest.fn().mockResolvedValue({ id: "sig-1", signedAt: new Date() }),
          },
          AuditLog: { create: jest.fn().mockResolvedValue(true) },
          User: activeUser,
        },
      });

      const result = await svc.signDocument("step-1", "u-1", {});

      expect(result.signatureId).toBe("sig-1");
      // Workflow stays open; the next signer is advanced to pending.
      expect(workflow.update).not.toHaveBeenCalled();
      expect(nextStep.update).toHaveBeenCalledWith({ status: "pending" });
    });

    it("leaves the workflow open when no waiting signer remains to promote", async () => {
      const workflow = {
        id: "wf-1",
        documentId: "doc-1",
        tenantId: "tenant-1",
        update: jest.fn().mockResolvedValue(true),
      };
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({
              id: "step-1",
              status: "pending",
              workflowId: "wf-1",
              tenantId: "tenant-1",
              update: jest.fn().mockResolvedValue(true),
            }),
            // Neither signed nor waiting: not all signed, nothing to promote.
            findAll: jest.fn().mockResolvedValue([{ status: "declined" }]),
          },
          SignatureWorkflow: { findByPk: jest.fn().mockResolvedValue(workflow) },
          SignatureRecord: {
            create: jest.fn().mockResolvedValue({ id: "sig-1", signedAt: new Date() }),
          },
          AuditLog: { create: jest.fn().mockResolvedValue(true) },
          User: activeUser,
        },
      });

      const result = await svc.signDocument("step-1", "u-1", {});

      expect(result.signatureId).toBe("sig-1");
      expect(workflow.update).not.toHaveBeenCalled();
    });

    it("masks an unexpected persistence failure as a 500", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({
              id: "step-1",
              status: "pending",
              workflowId: "wf-1",
              tenantId: "tenant-1",
            }),
          },
          SignatureWorkflow: {
            findByPk: jest.fn().mockResolvedValue({ id: "wf-1", documentId: "doc-1" }),
          },
          SignatureRecord: { create: jest.fn().mockRejectedValue(new Error("insert blew up")) },
          User: activeUser,
        },
      });

      await expect(svc.signDocument("step-1", "u-1", {})).rejects.toMatchObject({
        status: 500,
        message: "Failed to sign document",
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Signature failed",
        expect.objectContaining({ stepId: "step-1", userId: "u-1", error: "insert blew up" }),
      );
    });
  });

  // ================================================================
  // completeWorkflow runs only when every step is signed. It is private, so it
  // is driven here through signDocument.
  // ================================================================
  describe("completeWorkflow (via signDocument)", () => {
    const activeUser = { findByPk: jest.fn().mockResolvedValue({ id: "u-1", status: "active" }) };

    const buildModels = ({ workflowOnComplete, owner }) => {
      const workflow = {
        id: "wf-1",
        documentId: "doc-1",
        subject: "Sign me",
        tenantId: "tenant-1",
        update: jest.fn().mockResolvedValue(true),
      };
      return {
        workflow,
        models: {
          SignatureWorkflowStep: {
            findByPk: jest.fn().mockResolvedValue({
              id: "step-1",
              status: "pending",
              workflowId: "wf-1",
              tenantId: "tenant-1",
              update: jest.fn().mockResolvedValue(true),
            }),
            findAll: jest.fn().mockResolvedValue([{ status: "signed" }]),
          },
          SignatureWorkflow: {
            // 1st call: signDocument's lookup. 2nd: completeWorkflow's re-read.
            findByPk: jest
              .fn()
              .mockResolvedValueOnce(workflow)
              .mockResolvedValue(workflowOnComplete),
          },
          SignatureRecord: {
            create: jest.fn().mockResolvedValue({ id: "sig-1", signedAt: new Date() }),
          },
          AuditLog: { create: jest.fn().mockResolvedValue(true) },
          User: { ...activeUser, findOne: jest.fn().mockResolvedValue(owner) },
        },
      };
    };

    it("completes the workflow and attempts to notify the tenant owner", async () => {
      const { workflow, models } = buildModels({
        owner: { id: "owner-1", email: "owner@b.com" },
      });
      models.SignatureWorkflow.findByPk = jest.fn().mockResolvedValue(workflow);
      const svc = loadService({ models });

      const result = await svc.signDocument("step-1", "u-1", {});

      expect(result.signatureId).toBe("sig-1");
      expect(workflow.update).toHaveBeenCalledWith({ status: "completed" });
      // The owner notification uses the same broken emailQueueService import,
      // so it is swallowed by completeWorkflow's catch.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to notify on workflow completion",
        expect.objectContaining({ workflowId: "wf-1" }),
      );
    });

    it("skips the owner notification when no tenant owner is found", async () => {
      const { workflow, models } = buildModels({ owner: null });
      models.SignatureWorkflow.findByPk = jest.fn().mockResolvedValue(workflow);
      const svc = loadService({ models });

      await svc.signDocument("step-1", "u-1", {});

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        "Failed to notify on workflow completion",
        expect.anything(),
      );
    });

    it("skips the owner notification when the owner has no email", async () => {
      const { workflow, models } = buildModels({ owner: { id: "owner-1", email: null } });
      models.SignatureWorkflow.findByPk = jest.fn().mockResolvedValue(workflow);
      const svc = loadService({ models });

      await svc.signDocument("step-1", "u-1", {});

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        "Failed to notify on workflow completion",
        expect.anything(),
      );
    });

    it("returns quietly when the workflow disappears before completion", async () => {
      const { models } = buildModels({ workflowOnComplete: null, owner: null });
      const svc = loadService({ models });

      await svc.signDocument("step-1", "u-1", {});

      // completeWorkflow bailed at `if (!workflow) return` — no owner lookup.
      expect(models.User.findOne).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("verifySignature", () => {
    it("recomputes the hash for a live signature and reports the comparison", async () => {
      // NOTE: generateSignatureHash mixes Date.now() into the payload, so the
      // recomputed hash can never equal the stored one — see the report.
      const signedAt = new Date();
      const svc = loadService({
        models: {
          SignatureRecord: {
            findByPk: jest.fn().mockResolvedValue({
              id: "sig-1",
              workflowId: "wf-1",
              userId: "u-1",
              tenantId: "tenant-1",
              status: "signed",
              signatureHash: "stored-hash",
              signatureAlgorithm: "RS256",
              signedAt,
              ipAddress: "1.2.3.4",
              userAgent: "jest",
              authenticationMethod: "password",
              polygon: null,
              biometricData: null,
            }),
          },
          SignatureWorkflow: {
            findByPk: jest.fn().mockResolvedValue({ id: "wf-1", documentId: "doc-1" }),
          },
        },
      });

      const result = await svc.verifySignature("sig-1");

      expect(result.valid).toBe(false);
      expect(result.details).toMatchObject({
        signatureId: "sig-1",
        workflowId: "wf-1",
        documentId: "doc-1",
        signerId: "u-1",
        algorithm: "RS256",
        ipAddress: "1.2.3.4",
        userAgent: "jest",
        authenticationMethod: "password",
      });
    });

    it("reports the failure reason when the lookup throws", async () => {
      const svc = loadService({
        models: {
          SignatureRecord: { findByPk: jest.fn().mockRejectedValue(new Error("db offline")) },
          SignatureWorkflow: { findByPk: jest.fn() },
        },
      });

      const result = await svc.verifySignature("sig-1");

      expect(result).toEqual({ valid: false, reason: "db offline" });
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Signature verification failed",
        { signatureId: "sig-1", error: "db offline" },
      );
    });
  });

  // ================================================================
  describe("getWorkflow", () => {
    it("returns null and logs when the lookup throws", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflow: { findByPk: jest.fn().mockRejectedValue(new Error("boom")) },
          SignatureWorkflowStep: {},
        },
      });

      await expect(svc.getWorkflow("wf-1")).resolves.toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to get workflow",
        { workflowId: "wf-1", error: "boom" },
      );
    });
  });

  // ================================================================
  describe("cancelWorkflow", () => {
    it("masks an unexpected failure as a 500", async () => {
      const svc = loadService({
        models: {
          SignatureWorkflow: { findOne: jest.fn().mockRejectedValue(new Error("db gone")) },
        },
      });

      await expect(svc.cancelWorkflow("wf-1", "u-1", "tenant-1")).rejects.toMatchObject({
        status: 500,
        message: "Failed to cancel workflow",
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to cancel workflow",
        { workflowId: "wf-1", error: "db gone" },
      );
    });
  });

  // ================================================================
  describe("revokeSignature", () => {
    it("masks an unexpected failure as a 500", async () => {
      const svc = loadService({
        models: {
          SignatureRecord: { findOne: jest.fn().mockRejectedValue(new Error("db gone")) },
          AuditLog: { create: jest.fn() },
        },
      });

      await expect(
        svc.revokeSignature("sig-1", "u-1", "tenant-1", "mistake"),
      ).rejects.toMatchObject({ status: 500, message: "Failed to revoke signature" });
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to revoke signature",
        { signatureId: "sig-1", error: "db gone" },
      );
    });
  });
});
