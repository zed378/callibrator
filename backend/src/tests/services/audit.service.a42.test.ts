/**
 * A-42 — a failed audit write must reach winston at `error` (the file sinks
 * production collects), never only `console`, and inside a transaction it must
 * fail the transaction so a compliance-critical mutation cannot commit
 * unattributed.
 *
 * Runs against the auditLedger fixture: the real ENUM, real rollback.
 */
type LedgerRow = Record<string, unknown>;
interface Ledger {
  write: (table: string, row: LedgerRow, options?: unknown) => LedgerRow;
  committed: (table: string) => LedgerRow[];
  auditRows: () => LedgerRow[];
  transaction: (cb: (tx: unknown) => unknown) => Promise<unknown>;
  failNext: (table: string, error: Error) => void;
  AuditLog: { create: (...args: unknown[]) => unknown };
}

interface AuditEntry {
  tenantId: string | null;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
}

interface AuditService {
  logAction: (entry: AuditEntry, options?: { transaction?: unknown }) => Promise<unknown>;
}

interface Logger {
  error: jest.Mock;
  transports: { level?: string; dirname?: string }[];
}

const mockRef: { ledger: Ledger | null } = { ledger: null };

const ledger = (): Ledger => {
  if (!mockRef.ledger) {
    throw new Error("ledger not created");
  }
  return mockRef.ledger;
};

jest.mock("../../models", () => ({
  AuditLog: { create: (...args: unknown[]) => ledger().AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({ db: {} }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { createLedger } = require("../fixtures/auditLedger") as {
  createLedger: () => Ledger;
};
const { logger } = require("../../middlewares/activityLog.middleware") as { logger: Logger };
const auditService = require("../../services/audit.service") as AuditService;
/* eslint-enable @typescript-eslint/no-require-imports */

const entry = (overrides: Record<string, unknown> = {}): AuditEntry => ({
  tenantId: "tenant-1",
  userId: "user-1",
  action: "APPROVE",
  resourceType: "Certificate",
  resourceId: "cert-1",
  ...overrides,
});

/** An asymmetric matcher, typed so it can sit inside an object literal. */
const containing = (fields: Record<string, unknown>): unknown =>
  expect.objectContaining(fields) as unknown;

describe("A-42 — audit.service#logAction failure handling", () => {
  let errorSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockRef.ledger = createLedger();
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => logger);
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("the logger is winston with an error-level file sink", () => {
    const errorSinks = logger.transports.filter((t) => t.level === "error" && t.dirname?.endsWith("error") === true);
    expect(errorSinks).toHaveLength(1);
  });

  it("a failed write outside a transaction is logged at error through winston with the action's context — not console", async () => {
    ledger().failNext("audit_logs", new Error("connection reset"));

    const result = await auditService.logAction(entry());

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "Audit log write failed",
      containing({
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
    const led = ledger();
    led.failNext("audit_logs", new Error("connection reset"));

    await expect(
      led.transaction((transaction: unknown) => {
        led.write("certificates", { id: "cert-1", status: "approved" }, { transaction });
        return auditService.logAction(entry(), { transaction });
      }),
    ).rejects.toThrow("connection reset");

    expect(led.committed("certificates")).toEqual([]);
    expect(led.auditRows()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Audit log write failed",
      containing({ inTransaction: true, resourceId: "cert-1" }),
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("an out-of-ENUM action (RESTORE) is refused inside a transaction and nothing commits", async () => {
    const led = ledger();

    await expect(
      led.transaction((transaction: unknown) => {
        led.write("tenant_users", { id: "u-1" }, { transaction });
        return auditService.logAction(entry({ action: "RESTORE" }), { transaction });
      }),
    ).rejects.toThrow(/RESTORE/);

    expect(led.committed("tenant_users")).toEqual([]);
    expect(led.auditRows()).toEqual([]);
  });

  it("an out-of-ENUM action outside a transaction is logged at error and dropped, never inserted", async () => {
    const result: unknown = await auditService.logAction(entry({ action: "create" }));

    expect(result).toBeNull();
    expect(ledger().auditRows()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "Audit log write failed",
      containing({ action: "create", error: expect.stringMatching(/create/) as unknown }),
    );
  });

  it("a successful write inside a transaction commits with the mutation", async () => {
    const led = ledger();

    await led.transaction((transaction: unknown) => {
      led.write("certificates", { id: "cert-1" }, { transaction });
      return auditService.logAction(entry(), { transaction });
    });

    expect(led.committed("certificates")).toHaveLength(1);
    expect(led.auditRows()).toEqual([
      containing({ action: "APPROVE", resourceId: "cert-1", tenantId: "tenant-1" }),
    ]);
  });

  it("a mutation whose transaction rolls back leaves no audit row", async () => {
    const led = ledger();

    await expect(
      led.transaction((transaction: unknown) => {
        led.write("certificates", { id: "cert-1" }, { transaction });
        return auditService.logAction(entry(), { transaction }).then(() => {
          throw new Error("later step failed");
        });
      }),
    ).rejects.toThrow("later step failed");

    expect(led.committed("certificates")).toEqual([]);
    expect(led.auditRows()).toEqual([]);
  });
});
