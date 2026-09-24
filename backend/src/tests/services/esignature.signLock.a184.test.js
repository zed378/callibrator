/**
 * A-184 — signDocument decides under the workflow's lock.
 *
 * It used to read the step and the workflow BEFORE its transaction, with no
 * lock: a cancellation, or a second signature of the same step, committing
 * between that read and the signature was signed over (the e-signature form
 * of A-167, which fixed the certificate transitions the same way).
 *
 * The model doubles answer as READ COMMITTED does: a read that takes the lock
 * (inside the signing transaction) waits for the concurrent change and sees
 * it; an unlocked read sees the row as it was before. The real signing crypto
 * and the real credential check run; the password comparison is the boundary.
 * Writes go through the auditLedger fixture, so "nothing committed" is checked
 * against committed rows, not mock calls.
 */

const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null };
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const { generateTestKeyPair } = require("../utils/esignatureKey.utils");

const TENANT_ID = "tenant-a184";
const SIGNER = "u-a184";
const PASSWORD = "correct horse battery staple";
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe("A-184 — eSignature.service#signDocument reads under the lock", () => {
  let keyPair;

  beforeAll(() => {
    keyPair = generateTestKeyPair({ keyId: "key-a184" });
  });

  /**
   * @param {object} opts
   * @param {object} [opts.lockedStep] - the step as a locked read sees it
   * @param {object} [opts.lockedWorkflow] - the workflow as a locked read sees it
   */
  const buildHarness = ({ lockedStep = {}, lockedWorkflow = {} } = {}) => {
    mockRef.ledger = createLedger({ cls: false });
    const row = (table, fields) => {
      const r = { ...fields };
      r.update = jest.fn(async (values, options) => {
        Object.assign(r, values);
        return mockRef.ledger.write(table, { id: r.id, ...values }, options);
      });
      return r;
    };
    const stepBase = { id: "step-1", status: "pending", stepNumber: 1, workflowId: "wf-1", tenantId: TENANT_ID, signerId: SIGNER };
    const workflowBase = { id: "wf-1", documentId: "doc-1", tenantId: TENANT_ID, status: "in_progress" };
    const unlocked = { step: row("signature_workflow_steps", stepBase), workflow: row("signature_workflows", workflowBase) };
    const locked = {
      step: row("signature_workflow_steps", { ...stepBase, ...lockedStep }),
      workflow: row("signature_workflows", { ...workflowBase, ...lockedWorkflow }),
    };
    const reads = [];
    const read = (kind) =>
      jest.fn(async (id, options = {}) => {
        reads.push({ kind, transaction: options.transaction, lock: options.lock });
        return options.lock ? locked[kind] : unlocked[kind];
      });

    const models = {
      TenantKey: {
        unscoped: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(keyPair) })),
        findOne: jest.fn(),
      },
      SignatureWorkflowStep: {
        findByPk: read("step"),
        findAll: jest.fn(async () => [{ status: "signed" }]),
      },
      SignatureWorkflow: { findByPk: read("workflow") },
      SignatureRecord: {
        create: jest.fn(async (attrs, options) => ({
          ...mockRef.ledger.write("signature_records", attrs, options),
          id: "sig-1",
        })),
      },
      AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
      User: {
        findByPk: jest.fn(async () => ({ id: SIGNER, status: "ACTIVE", isActive: true })),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };

    jest.resetModules();
    jest.doMock("../../models", () => models);
    jest.doMock("../../middlewares/activityLog.middleware", () => ({ logger: mockLogger }));
    jest.doMock("../../services/auth.service", () => ({
      passIsValid: jest.fn(async (userId, password) => ({ data: { valid: password === PASSWORD } })),
    }));
    jest.doMock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));
    const svc = require("../../services/eSignature.service");
    return { svc, models, reads, locked };
  };

  const sign = (svc) =>
    svc.signDocument("step-1", SIGNER, { authenticationMethod: "password", authPayload: PASSWORD, reason: "Approved" });

  it("a workflow cancelled after the step was read is refused 409, and nothing is committed", async () => {
    const h = buildHarness({ lockedWorkflow: { status: "cancelled" } });

    const err = await sign(h.svc).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain('"cancelled"');
    expect(mockRef.ledger.rows).toEqual([]);
    expect(h.models.SignatureRecord.create).not.toHaveBeenCalled();
  });

  it("a step signed concurrently (seen only under the lock) is refused 409 — it is not signed twice", async () => {
    const h = buildHarness({ lockedStep: { status: "signed" } });

    const err = await sign(h.svc).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain('"signed"');
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("an expiry found under the lock is committed with its audit row, and the signature refused", async () => {
    const h = buildHarness({ lockedWorkflow: { expiresAt: new Date(Date.now() - 60_000).toISOString() } });

    const err = await sign(h.svc).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain('"expired"');
    expect(mockRef.ledger.committed("signature_workflows")).toEqual([{ id: "wf-1", status: "expired" }]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        action: "UPDATE",
        resourceType: "SignatureWorkflow",
        resourceId: "wf-1",
        changes: expect.objectContaining({ operation: "EXPIRE", after: { status: "expired" } }),
      }),
    ]);
    expect(mockRef.ledger.committed("signature_records")).toEqual([]);
  });

  it("the workflow and then the step are locked FOR UPDATE inside the signing transaction", async () => {
    const h = buildHarness();

    await sign(h.svc);

    const lockedReads = h.reads.filter((r) => r.lock);
    expect(lockedReads.map((r) => r.kind)).toEqual(["workflow", "step"]);
    expect(lockedReads.every((r) => r.lock === "UPDATE" && r.transaction)).toBe(true);
    // Every read is inside the signing transaction — none before it.
    expect(h.reads.every((r) => r.transaction)).toBe(true);
    // And the signature, its step and its audit row committed together.
    expect(mockRef.ledger.committed("signature_records")).toHaveLength(1);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ action: "APPROVE", changes: expect.objectContaining({ operation: "SIGN" }) }),
    ]);
  });
});
