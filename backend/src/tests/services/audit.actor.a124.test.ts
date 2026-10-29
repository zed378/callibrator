/**
 * A-124 (ADR-051 Q-13) — every audit row names exactly one actor: a user, or a
 * system job from the closed list in constants/systemActors.js.
 *
 * Effects against the auditLedger fixture, which enforces the model's
 * `actor_type` ENUM and migration 0033's CHECK `audit_logs_actor_check` — the
 * contract, not a jest.fn() that accepts anything. The refusals follow A-42:
 * re-thrown inside a transaction (the mutation rolls back), logged at `error`
 * and `null` outside one.
 */
import type * as ActivityLogModule from "../../middlewares/activityLog.middleware";
import type * as SystemActorsModule from "../../constants/systemActors";

type LedgerRow = Record<string, unknown>;
interface Ledger {
    write: (table: string, row: LedgerRow, options?: unknown) => LedgerRow;
    committed: (table: string) => LedgerRow[];
    auditRows: () => LedgerRow[];
    transaction: (cb?: (tx: unknown) => unknown) => unknown;
    AuditLog: { create: (...args: unknown[]) => unknown };
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

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { createLedger } = require("../fixtures/auditLedger") as {
    createLedger: (o: { cls: boolean }) => Ledger;
};
const auditService = require("../../services/audit.service") as {
    logAction: (
        entry: Record<string, unknown>,
        options?: { transaction?: unknown },
    ) => Promise<Record<string, unknown> | null>;
};
const { logger } = require("../../middlewares/activityLog.middleware") as typeof ActivityLogModule;
const { SYSTEM_ACTORS } = require("../../constants/systemActors") as typeof SystemActorsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const ENTRY = { tenantId: "tenant-1", action: "UPDATE", resourceType: "Thing", resourceId: "thing-1" };

describe("A-124 — logAction names exactly one actor", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  afterEach(() => jest.restoreAllMocks());

  it("a user entry is written as actor_type 'user' with no actor name", async () => {
    const row = await auditService.logAction({ ...ENTRY, userId: "user-1" });

    expect(row).toMatchObject({ userId: "user-1", actorType: "user", actorName: null });
    expect(ledger().auditRows()).toEqual([
      expect.objectContaining({ userId: "user-1", actorType: "user", actorName: null }),
    ]);
  });

  it.each(Object.values(SYSTEM_ACTORS))(
    "a system entry for %s is written as actor_type 'system' with that name and no user",
    async (name: string) => {
      const row = await auditService.logAction({ ...ENTRY, systemActor: name });

      expect(row).toMatchObject({ userId: null, actorType: "system", actorName: name });
    },
  );

  it("an entry with neither a user nor a system actor is refused inside a transaction — nothing commits", async () => {
    await expect(
      (ledger().transaction as (cb: (transaction: unknown) => Promise<unknown>) => Promise<unknown>)(
        async (transaction: unknown) => {
          ledger().write("things", { id: "thing-1" }, { transaction });
          await auditService.logAction({ ...ENTRY, userId: null }, { transaction });
        },
      ),
    ).rejects.toThrow(/must name its actor/);

    expect(ledger().committed("things")).toEqual([]);
    expect(ledger().auditRows()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({ inTransaction: true, userId: null, systemActor: null }),
    );
  });

  it("an entry with neither, outside a transaction, is logged and returns null — no row", async () => {
    await expect(auditService.logAction({ ...ENTRY })).resolves.toBeNull();

    expect(ledger().auditRows()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({
        inTransaction: false,
        error: expect.stringMatching(/must name its actor/) as unknown,
      }),
    );
  });

  it("an entry naming both a user and a system actor is refused", async () => {
    await expect(
      auditService.logAction(
        { ...ENTRY, userId: "user-1", systemActor: SYSTEM_ACTORS.RETENTION_PURGE },
        { transaction: await (ledger().transaction as () => Promise<unknown>)() },
      ),
    ).rejects.toThrow(/names one actor/);
  });

  it.each(["system:made-up", "retention", "system:retention-purge ", "SYSTEM:RETENTION-PURGE"])(
    "an unregistered system actor %p is refused — the list is closed",
    async (name: string) => {
      await expect(
        auditService.logAction({ ...ENTRY, systemActor: name }, { transaction: await (ledger().transaction as () => Promise<unknown>)() }),
      ).rejects.toThrow(/Unknown system actor/);
      expect(ledger().auditRows()).toEqual([]);
    },
  );

  it("an invalid action is still refused first, as before (A-42)", async () => {
    await expect(
      auditService.logAction({ ...ENTRY, action: "RESTORE", userId: "user-1" }, { transaction: {} }),
    ).rejects.toThrow(/Invalid audit action/);
  });
});
