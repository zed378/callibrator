/**
 * A-42 — a failed audit write must reach winston at `error` (the file sinks
 * production collects), never only `console`, and inside a transaction it must
 * fail the transaction so a compliance-critical mutation cannot commit
 * unattributed.
 *
 * Runs against the auditLedger fixture: the real ENUM, real rollback.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null };

jest.mock("../../models", () => ({
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({ db: {} }));

const { logger } = require("../../middlewares/activityLog.middleware");
const auditService = require("../../services/audit.service");

const entry = (overrides = {}) => ({
  tenantId: "tenant-1",
  userId: "user-1",
  action: "APPROVE",
  resourceType: "Certificate",
  resourceId: "cert-1",
  ...overrides,
});

describe("A-42 — audit.service#logAction failure handling", () => {
  let errorSpy;
  let consoleSpy;

  beforeEach(() => {
    mockRef.ledger = createLedger();
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => logger);
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("the logger is winston with an error-level file sink", () => {
    const errorSinks = logger.transports.filter(
      (t) => t.level === "error" && t.dirname && /error$/.test(t.dirname),
    );
    expect(errorSinks).toHaveLength(1);
  });

  it("a failed write outside a transaction is logged at error through winston with the action's context — not console", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("connection reset"));

    const result = await auditService.logAction(entry());

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        action: "APPROVE",
        resourceType: "Certificate",
        resourceId: "cert-1",
        inTransaction: false,
        error: "connection reset",
      }),
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("inside a transaction, a failed write is re-thrown and the mutation rolls back with it", async () => {
    const { ledger } = mockRef;
    ledger.failNext("audit_logs", new Error("connection reset"));

    await expect(
      ledger.transaction(async (transaction) => {
        ledger.write("certificates", { id: "cert-1", status: "approved" }, { transaction });
        await auditService.logAction(entry(), { transaction });
      }),
    ).rejects.toThrow("connection reset");

    expect(ledger.committed("certificates")).toEqual([]);
    expect(ledger.auditRows()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({ inTransaction: true, resourceId: "cert-1" }),
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("an out-of-ENUM action (RESTORE) is refused inside a transaction and nothing commits", async () => {
    const { ledger } = mockRef;

    await expect(
      ledger.transaction(async (transaction) => {
        ledger.write("tenant_users", { id: "u-1" }, { transaction });
        await auditService.logAction(entry({ action: "RESTORE" }), { transaction });
      }),
    ).rejects.toThrow(/RESTORE/);

    expect(ledger.committed("tenant_users")).toEqual([]);
    expect(ledger.auditRows()).toEqual([]);
  });

  it("an out-of-ENUM action outside a transaction is logged at error and dropped, never inserted", async () => {
    const result = await auditService.logAction(entry({ action: "create" }));

    expect(result).toBeNull();
    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({ action: "create", error: expect.stringMatching(/create/) }),
    );
  });

  it("a successful write inside a transaction commits with the mutation", async () => {
    const { ledger } = mockRef;

    await ledger.transaction(async (transaction) => {
      ledger.write("certificates", { id: "cert-1" }, { transaction });
      await auditService.logAction(entry(), { transaction });
    });

    expect(ledger.committed("certificates")).toHaveLength(1);
    expect(ledger.auditRows()).toEqual([
      expect.objectContaining({ action: "APPROVE", resourceId: "cert-1", tenantId: "tenant-1" }),
    ]);
  });

  it("a mutation whose transaction rolls back leaves no audit row", async () => {
    const { ledger } = mockRef;

    await expect(
      ledger.transaction(async (transaction) => {
        ledger.write("certificates", { id: "cert-1" }, { transaction });
        await auditService.logAction(entry(), { transaction });
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");

    expect(ledger.committed("certificates")).toEqual([]);
    expect(ledger.auditRows()).toEqual([]);
  });
});
