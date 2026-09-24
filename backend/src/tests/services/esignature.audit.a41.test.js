/**
 * A-41 — e-signature signing and revocation write their audit row inside the
 * same transaction as the signature (MEMORY/specs/A-41-audit-inside-transaction.md,
 * rows 11–12).
 *
 * The defect this pins: signDocument/revokeSignature wrote
 * `action: "DOCUMENT_SIGNED"` / `"SIGNATURE_REVOKED"` with columns
 * `entityType/entityId/before/after` that do not exist. PostgreSQL rejects
 * that row — AFTER the signature record had already committed, outside any
 * transaction. The old unit test asserted "DOCUMENT_SIGNED" against a mock
 * that accepts anything. This one runs against the auditLedger fixture: the
 * real ENUM, real rollback, and `cls: false` so every write must carry
 * `{ transaction }`. The signature itself is REAL RSA (ADR-040).
 */
const { createLedger } = require("../fixtures/auditLedger");
const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const mockRef = { ledger: null, keyPair: null, steps: null, signature: null };

const mockWrite = (table) => async (values, options) =>
  mockRef.ledger.write(table, values, options);

jest.mock("../../models", () => ({
  TenantKey: {
    unscoped: () => ({ findOne: async () => mockRef.keyPair }),
    findOne: async () => mockRef.keyPair,
  },
  SignatureWorkflowStep: {
    findByPk: async () => mockRef.steps[0],
    findAll: async () => mockRef.steps,
  },
  SignatureWorkflow: {
    findByPk: async () => ({
      id: "wf-1",
      documentId: "doc-1",
      tenantId: "tenant-1",
      subject: "Sign me",
      update: (values, options) =>
        mockRef.ledger.write("signature_workflows", { id: "wf-1", ...values }, options),
    }),
  },
  SignatureRecord: {
    create: async (values, options) => {
      mockRef.ledger.write("signature_records", values, options);
      return { id: "sig-1", ...values };
    },
    findOne: async () => mockRef.signature,
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {
    findByPk: async () => ({ id: "u-1", status: "ACTIVE", isActive: true }),
    findOne: async () => null,
  },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
// A-65 — signing re-authenticates the signer; the password check is doubled.
jest.mock("../../services/auth.service", () => ({
  passIsValid: async () => ({ data: { valid: true } }),
}));
// A-158: the real export — emailQueueService.queueEmail never existed. That
// this module really exports it is asserted in esignature.a158a159.test.js.
jest.mock("../../services/emailQueue.service", () => ({
  queueNotificationEmail: jest.fn(async () => true),
}));

const eSignatureService = require("../../services/eSignature.service");
const { queueNotificationEmail } = require("../../services/emailQueue.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const makeStep = (id, status, stepNumber) => {
  const step = { id, status, stepNumber, workflowId: "wf-1", tenantId: "tenant-1", signerId: "u-1", signerEmail: `${id}@x` };
  step.update = (values, options) => {
    const row = mockRef.ledger.write("signature_workflow_steps", { id, ...values }, options);
    Object.assign(step, values);
    return row;
  };
  return step;
};

const sign = () =>
  eSignatureService.signDocument("step-1", "u-1", {
    authenticationMethod: "password",
    authPayload: "pw",
    reason: "Approved by QA",
    ipAddress: "10.0.0.1",
    userAgent: "UA",
  });

describe("A-41 — e-signature audit inside the signing transaction", () => {
  beforeAll(() => {
    mockRef.keyPair = generateTestKeyPair({ keyId: "key-a41" });
  });

  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.steps = [makeStep("step-1", "pending", 1)];
    jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(logger, "info").mockImplementation(() => logger);
    jest.spyOn(logger, "warn").mockImplementation(() => logger);
    queueNotificationEmail.mockClear();
  });

  describe("signDocument", () => {
    it("commits the signature, the step, the workflow and exactly one valid audit row", async () => {
      const result = await sign();

      expect(result.signatureId).toBe("sig-1");
      expect(mockRef.ledger.committed("signature_records")).toHaveLength(1);
      expect(mockRef.ledger.committed("signature_workflow_steps")).toEqual([
        expect.objectContaining({ id: "step-1", status: "signed" }),
      ]);
      expect(mockRef.ledger.committed("signature_workflows")).toEqual([
        expect.objectContaining({ status: "completed" }),
      ]);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "u-1",
          action: "APPROVE",
          resourceType: "SignatureWorkflow",
          resourceId: "wf-1",
          ipAddress: "10.0.0.1",
          userAgent: "UA",
          changes: expect.objectContaining({
            operation: "SIGN",
            before: { stepId: "step-1", status: "pending" },
            after: expect.objectContaining({
              signatureId: "sig-1",
              signingKeyId: "key-a41",
              signatureScheme: "esig-v2-rsa-sha256",
              reason: "Approved by QA",
            }),
          }),
        }),
      ]);
      // The signature value is not a secret, but it is not what the audit row is for.
      expect(JSON.stringify(mockRef.ledger.auditRows()[0].changes)).not.toContain("signatureValue");
    });

    it("a failing audit insert rolls the signature back — no signature exists without its audit row", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(sign()).rejects.toThrow();

      expect(mockRef.ledger.committed("signature_records")).toEqual([]);
      expect(mockRef.ledger.committed("signature_workflow_steps")).toEqual([]);
      expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a rolled-back signing transaction (workflow update fails) leaves no audit row", async () => {
      mockRef.ledger.failNext("signature_workflows", new Error("workflow write failed"));

      await expect(sign()).rejects.toThrow();

      expect(mockRef.ledger.committed("signature_records")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("advancing to the next signer commits with the signature; the request email goes out after commit", async () => {
      mockRef.steps = [makeStep("step-1", "pending", 1), makeStep("step-2", "waiting", 2)];

      await sign();

      expect(mockRef.ledger.committed("signature_workflow_steps")).toEqual([
        expect.objectContaining({ id: "step-1", status: "signed" }),
        expect.objectContaining({ id: "step-2", status: "pending" }),
      ]);
      expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
      expect(queueNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: "step-2@x", title: "Signature request: Sign me" }),
      );
      expect(mockRef.ledger.auditRows()).toHaveLength(1);
    });

    it("no email is sent for a signature that rolled back", async () => {
      mockRef.steps = [makeStep("step-1", "pending", 1), makeStep("step-2", "waiting", 2)];
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(sign()).rejects.toThrow();

      expect(queueNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe("revokeSignature", () => {
    beforeEach(() => {
      mockRef.signature = {
        id: "sig-1",
        status: "signed",
        update: (values, options) =>
          mockRef.ledger.write("signature_records", { id: "sig-1", ...values }, options),
      };
    });

    const revoke = () => eSignatureService.revokeSignature("sig-1", "u-2", "tenant-1", "signed in error");

    it("commits the revocation with exactly one valid audit row", async () => {
      await revoke();

      expect(mockRef.ledger.committed("signature_records")).toEqual([
        expect.objectContaining({ status: "revoked", revokedBy: "u-2" }),
      ]);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "u-2",
          action: "UPDATE",
          resourceType: "SignatureRecord",
          resourceId: "sig-1",
          changes: {
            operation: "REVOKE",
            before: { status: "signed" },
            after: { status: "revoked", reason: "signed in error" },
          },
        }),
      ]);
    });

    it("a failing audit insert leaves the signature unrevoked", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(revoke()).rejects.toThrow();

      expect(mockRef.ledger.committed("signature_records")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a rolled-back revocation leaves no audit row", async () => {
      mockRef.ledger.failNext("signature_records", new Error("write failed"));

      await expect(revoke()).rejects.toThrow();

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });
  });
});
