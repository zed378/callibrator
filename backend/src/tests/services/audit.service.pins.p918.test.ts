/**
 * P9-18 — three properties of audit.service no suite asserted. The service's
 * conversion to TypeScript planted each as a defect in a scratch mirror, and
 * every existing suite (49 that load the real module) still passed:
 *
 *  1. FAIL SECURE (A-126): when the lock's transaction fails — the audit
 *     insert, most likely — the lock is persisted ON ITS OWN, outside any
 *     transaction. Dropping that fallback switches brute-force protection off
 *     for as long as audit writes fail.
 *  2. The list's `user` and `impersonator` includes are `required: false`
 *     (CLAUDE.md, "The Traps"): User has a defaultScope, so an include without
 *     it is an INNER JOIN, and every row by a deleted user, or by a system
 *     actor (userId NULL), vanishes from the trail.
 *  3. recordAccountLock writes its row through the EXPORTED logAction, read at
 *     call time, so a spy on it (A-41 rollback tests do this) sees the call.
 */
import type { Transaction } from "sequelize";
import type * as AuditServiceModule from "../../services/audit.service";

const mockTransaction = jest.fn();

jest.mock("../../config", () => ({ db: { transaction: (...args: unknown[]): unknown => mockTransaction(...args) } }));
jest.mock("../../models", () => ({
  AuditLog: { create: jest.fn(), findAll: jest.fn() },
  User: { name: "User" },
  sequelize: {},
}));
jest.mock("../../utils/sql.util", () => ({ sql: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks above are registered
const auditService = require("../../services/audit.service") as typeof AuditServiceModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked models, to drive and inspect
const models = require("../../models") as unknown as {
  AuditLog: { create: jest.Mock; findAll: jest.Mock };
  User: unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked raw count
const { sql } = require("../../utils/sql.util") as unknown as { sql: jest.Mock };

const TX = { id: "lock-tx" } as unknown as Transaction;
const lock = (persistLock: (t: Transaction | null) => Promise<unknown>): Parameters<typeof auditService.recordAccountLock>[0] => ({
  persistLock,
  user: { id: "u1", tenantId: "t1" },
  lockedUntil: new Date("2026-10-01T12:00:00.000Z"),
  failedAttempts: 5,
  endpoint: "login",
  ipAddress: "203.0.113.7",
  userAgent: null,
});

describe("audit.service — pins found by the P9-18 planted defects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("recordAccountLock fails secure (A-126)", () => {
    it("a failed audit insert still persists the lock, outside any transaction, and answers false", async () => {
      mockTransaction.mockImplementation(async (work: (t: Transaction) => Promise<unknown>) => work(TX));
      models.AuditLog.create.mockRejectedValue(new Error("audit insert failed"));
      const persistLock = jest.fn<Promise<void>, [Transaction | null]>(() => Promise.resolve());

      await expect(auditService.recordAccountLock(lock(persistLock))).resolves.toBe(false);
      expect(persistLock.mock.calls).toEqual([[TX], [null]]);
    });

    it("a transaction that cannot even start still persists the lock on its own", async () => {
      mockTransaction.mockRejectedValue(new Error("pool exhausted"));
      const persistLock = jest.fn<Promise<void>, [Transaction | null]>(() => Promise.resolve());

      await expect(auditService.recordAccountLock(lock(persistLock))).resolves.toBe(false);
      expect(persistLock.mock.calls).toEqual([[null]]);
    });

    it("a lock whose fallback write fails too is an error, not a silent success", async () => {
      mockTransaction.mockRejectedValue(new Error("pool exhausted"));
      const persistLock = jest.fn<Promise<void>, [Transaction | null]>(() => Promise.reject(new Error("users update failed")));

      await expect(auditService.recordAccountLock(lock(persistLock))).rejects.toThrow("users update failed");
    });

    it("the row goes through the exported logAction, read at call time", async () => {
      mockTransaction.mockImplementation(async (work: (t: Transaction) => Promise<unknown>) => work(TX));
      const spy = jest.spyOn(auditService, "logAction").mockResolvedValue({ id: "a1" });

      await expect(auditService.recordAccountLock(lock(() => Promise.resolve()))).resolves.toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toMatchObject({ action: "ACCOUNT_LOCKED", systemActor: "system:auth-lockout", resourceId: "u1" });
      expect(spy.mock.calls[0]?.[1]).toEqual({ transaction: TX });
      expect(models.AuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("fetchAuditLogs keeps rows whose actor is gone or a system job", () => {
    it("both User includes are LEFT joins (required: false)", async () => {
      models.AuditLog.findAll.mockResolvedValue([]);
      sql.mockResolvedValue([{ n: 0 }]);

      await auditService.fetchAuditLogs({ tenantId: "t1" });
      const options = (models.AuditLog.findAll.mock.calls as unknown[][])[0]?.[0] as { include: { model: unknown; as: string; required?: boolean }[] };
      expect(options.include.map((i) => [i.as, i.model, i.required])).toEqual([
        ["user", models.User, false],
        ["impersonator", models.User, false],
      ]);
    });
  });
});
