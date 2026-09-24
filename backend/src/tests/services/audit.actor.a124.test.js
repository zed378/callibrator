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
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null };

jest.mock("../../models", () => ({
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {},
}));

const auditService = require("../../services/audit.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const { SYSTEM_ACTORS } = require("../../constants/systemActors");

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
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ userId: "user-1", actorType: "user", actorName: null }),
    ]);
  });

  it.each(Object.values(SYSTEM_ACTORS))(
    "a system entry for %s is written as actor_type 'system' with that name and no user",
    async (name) => {
      const row = await auditService.logAction({ ...ENTRY, systemActor: name });

      expect(row).toMatchObject({ userId: null, actorType: "system", actorName: name });
    },
  );

  it("an entry with neither a user nor a system actor is refused inside a transaction — nothing commits", async () => {
    await expect(
      mockRef.ledger.transaction(async (transaction) => {
        mockRef.ledger.write("things", { id: "thing-1" }, { transaction });
        await auditService.logAction({ ...ENTRY, userId: null }, { transaction });
      }),
    ).rejects.toThrow(/must name its actor/);

    expect(mockRef.ledger.committed("things")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({ inTransaction: true, userId: null, systemActor: null }),
    );
  });

  it("an entry with neither, outside a transaction, is logged and returns null — no row", async () => {
    await expect(auditService.logAction({ ...ENTRY })).resolves.toBeNull();

    expect(mockRef.ledger.auditRows()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "Audit log write failed",
      expect.objectContaining({ inTransaction: false, error: expect.stringMatching(/must name its actor/) }),
    );
  });

  it("an entry naming both a user and a system actor is refused", async () => {
    await expect(
      auditService.logAction(
        { ...ENTRY, userId: "user-1", systemActor: SYSTEM_ACTORS.RETENTION_PURGE },
        { transaction: await mockRef.ledger.transaction() },
      ),
    ).rejects.toThrow(/names one actor/);
  });

  it.each(["system:made-up", "retention", "system:retention-purge ", "SYSTEM:RETENTION-PURGE"])(
    "an unregistered system actor %p is refused — the list is closed",
    async (name) => {
      await expect(
        auditService.logAction({ ...ENTRY, systemActor: name }, { transaction: await mockRef.ledger.transaction() }),
      ).rejects.toThrow(/Unknown system actor/);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    },
  );

  it("an invalid action is still refused first, as before (A-42)", async () => {
    await expect(
      auditService.logAction({ ...ENTRY, action: "RESTORE", userId: "user-1" }, { transaction: {} }),
    ).rejects.toThrow(/Invalid audit action/);
  });
});
