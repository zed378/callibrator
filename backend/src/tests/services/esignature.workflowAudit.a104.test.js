/**
 * A-104 — updateWorkflow, cancelWorkflow and deleteWorkflow write their audit
 * row INSIDE the mutation's transaction.
 *
 * The defect this pins: the three workflow-management mutations wrote no
 * audit row and used no transaction. A signature workflow is a Part 11
 * record; editing, cancelling or deleting one committed unattributed.
 *
 * Runs against the auditLedger fixture: the REAL audit_logs ENUM and NOT NULL
 * columns (read from the model, not from the code under test), real
 * rollback, and `cls: false`, so a write that does not pass `{ transaction }`
 * autocommits and survives the rollback — and the test sees it.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, workflow: null };

jest.mock("../../models", () => ({
  SignatureWorkflow: {
    findOne: async () => mockRef.workflow,
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const eSignatureService = require("../../services/eSignature.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const ACTOR = { userId: "u-9", tenantId: "tenant-1", ipAddress: "10.0.0.7", userAgent: "UA-a104" };

const makeWorkflow = (status = "pending") => {
  const workflow = {
    id: "wf-1",
    tenantId: "tenant-1",
    documentId: "doc-1",
    subject: "Old subject",
    message: "Old message",
    expiresAt: null,
    status,
  };
  workflow.update = async (values, options) => {
    mockRef.ledger.write("signature_workflows", { id: "wf-1", ...values }, options);
    Object.assign(workflow, values);
    return workflow;
  };
  workflow.destroy = async (options) =>
    mockRef.ledger.write("signature_workflows", { id: "wf-1", deletedAt: new Date() }, options);
  return workflow;
};

describe("A-104 — e-signature workflow management audits inside the transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.workflow = makeWorkflow();
    jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(logger, "info").mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("updateWorkflow", () => {
    const update = () =>
      eSignatureService.updateWorkflow("wf-1", "tenant-1", { subject: "New subject" }, ACTOR);

    it("commits the edit with exactly one valid audit row naming the actor, before and after", async () => {
      await update();

      expect(mockRef.ledger.committed("signature_workflows")).toEqual([
        { id: "wf-1", subject: "New subject" },
      ]);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "u-9",
          action: "UPDATE",
          resourceType: "SignatureWorkflow",
          resourceId: "wf-1",
          ipAddress: "10.0.0.7",
          userAgent: "UA-a104",
          changes: { before: { subject: "Old subject" }, after: { subject: "New subject" } },
        }),
      ]);
    });

    it("a failing audit insert rolls the edit back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(update()).rejects.toMatchObject({ status: 500 });

      expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a failing edit leaves no audit row", async () => {
      mockRef.ledger.failNext("signature_workflows", new Error("write failed"));

      await expect(update()).rejects.toMatchObject({ status: 500 });

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a refused edit (closed workflow, 409) writes nothing", async () => {
      mockRef.workflow = makeWorkflow("completed");

      await expect(update()).rejects.toMatchObject({ status: 409 });

      expect(mockRef.ledger.rows).toEqual([]);
    });

    it("an actor-less call still records the row, with a null user", async () => {
      await eSignatureService.updateWorkflow("wf-1", "tenant-1", { message: "m" });

      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({ userId: null, ipAddress: null, userAgent: null }),
      ]);
    });
  });

  describe("cancelWorkflow", () => {
    const cancel = () => eSignatureService.cancelWorkflow("wf-1", "u-9", "tenant-1", ACTOR);

    it("commits the cancellation with exactly one audit row (UPDATE, operation CANCEL)", async () => {
      await cancel();

      expect(mockRef.ledger.committed("signature_workflows")).toEqual([
        { id: "wf-1", status: "cancelled" },
      ]);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "u-9",
          action: "UPDATE",
          resourceType: "SignatureWorkflow",
          resourceId: "wf-1",
          ipAddress: "10.0.0.7",
          userAgent: "UA-a104",
          changes: {
            operation: "CANCEL",
            before: { status: "pending" },
            after: { status: "cancelled" },
          },
        }),
      ]);
    });

    it("the audit row's user is the cancelling user, whatever the actor says", async () => {
      await eSignatureService.cancelWorkflow("wf-1", "u-9", "tenant-1", { userId: "someone-else" });

      expect(mockRef.ledger.auditRows()[0].userId).toBe("u-9");
    });

    it("a failing audit insert rolls the cancellation back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(cancel()).rejects.toMatchObject({ status: 500 });

      expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a completed workflow (409) writes nothing", async () => {
      mockRef.workflow = makeWorkflow("completed");

      await expect(cancel()).rejects.toMatchObject({ status: 409 });

      expect(mockRef.ledger.rows).toEqual([]);
    });
  });

  describe("deleteWorkflow", () => {
    const remove = () => eSignatureService.deleteWorkflow("wf-1", "tenant-1", ACTOR);

    it("commits the soft delete with exactly one DELETE audit row", async () => {
      await remove();

      expect(mockRef.ledger.committed("signature_workflows")).toEqual([
        expect.objectContaining({ id: "wf-1", deletedAt: expect.any(Date) }),
      ]);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "u-9",
          action: "DELETE",
          resourceType: "SignatureWorkflow",
          resourceId: "wf-1",
          changes: { before: { status: "pending", documentId: "doc-1" } },
        }),
      ]);
    });

    it("a failing audit insert rolls the delete back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(remove()).rejects.toMatchObject({ status: 500 });

      expect(mockRef.ledger.committed("signature_workflows")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a missing workflow (404) writes nothing", async () => {
      mockRef.workflow = null;

      await expect(remove()).rejects.toMatchObject({ status: 404 });

      expect(mockRef.ledger.rows).toEqual([]);
    });
  });
});
