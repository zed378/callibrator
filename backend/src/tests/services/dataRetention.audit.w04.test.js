/**
 * W-04 — the retention purge must record what it destroyed, in the same
 * transaction as the destruction (MEMORY/specs/A-41-audit-inside-transaction.md,
 * row 25), so an auditor can answer "what did your retention job delete, and
 * when?". Since A-121 it destroys notifications and sessions only; audit rows
 * are never purged (dataRetention.a121.test.js).
 *
 * Effects against the auditLedger fixture (real ENUM, real rollback), with
 * `cls: false` so every delete must carry `{ transaction }` explicitly.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, counts: null, settings: [], legalHold: null };

const mockPurge = (table) => async ({ where, transaction }) => {
  mockRef.ledger.write(`purge:${table}`, { where }, { transaction });
  return mockRef.counts[table];
};

jest.mock("../../models", () => ({
  AuditLog: {
    create: (...args) => mockRef.ledger.AuditLog.create(...args),
    destroy: mockPurge("audit_logs"),
  },
  Notification: { destroy: mockPurge("notifications") },
  Session: { destroy: mockPurge("sessions") },
  TenantSettings: {
    findAll: async () => mockRef.settings,
    findOne: async () => mockRef.legalHold,
  },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const dataRetention = require("../../services/dataRetention.service");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("W-04 — the retention purge audits what it destroyed", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.counts = { audit_logs: 120, notifications: 7, sessions: 3 };
    mockRef.settings = [];
    mockRef.legalHold = null;
    jest.spyOn(logger, "info").mockImplementation(() => logger);
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  it("commits the purge with one valid audit row naming each table's count and cutoff", async () => {
    const result = await dataRetention.purgeExpiredRecords("tenant-1");

    expect(result.purged).toEqual({ notifications: 7, sessions: 3 });
    expect(mockRef.ledger.committed("purge:notifications")).toHaveLength(1);
    expect(mockRef.ledger.committed("purge:audit_logs")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: null,
        action: "DELETE",
        resourceType: "DataRetention",
        changes: expect.objectContaining({
          operation: "RETENTION_PURGE",
          actor: "system:retention-purge",
          before: {
            retentionDays: { notifications: 90, sessions: 30, iot_readings: 0 },
          },
          after: {
            purged: { notifications: 7, sessions: 3 },
            cutoffs: {
              notifications: expect.any(String),
              sessions: expect.any(String),
            },
          },
        }),
      }),
    ]);
  });

  it("a failing audit insert rolls the purge back — nothing is destroyed unrecorded", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    await expect(dataRetention.purgeExpiredRecords("tenant-1")).rejects.toThrow("audit insert failed");

    expect(mockRef.ledger.committed("purge:notifications")).toEqual([]);
    expect(mockRef.ledger.committed("purge:sessions")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a purge that fails part-way rolls back entirely and leaves no audit row", async () => {
    mockRef.ledger.failNext("purge:sessions", new Error("sessions delete failed"));

    await expect(dataRetention.purgeExpiredRecords("tenant-1")).rejects.toThrow("sessions delete failed");

    expect(mockRef.ledger.committed("purge:notifications")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a purge that destroys nothing writes no audit row", async () => {
    mockRef.counts = { audit_logs: 0, notifications: 0, sessions: 0 };

    const result = await dataRetention.purgeExpiredRecords("tenant-1");

    expect(result.purged).toEqual({});
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("a tenant on legal hold is not purged and nothing is written", async () => {
    mockRef.legalHold = { value: "true" };

    const result = await dataRetention.purgeExpiredRecords("tenant-1");

    expect(result).toEqual({ skipped: true, reason: "legal_hold" });
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("the sweep counts a tenant whose purge rolled back as an error, and continues", async () => {
    const { Tenant } = require("../../models");
    // runRetentionSweep requires Tenant lazily from the models barrel.
    require("../../models").Tenant = { findAll: async () => [{ id: "tenant-1" }, { id: "tenant-2" }] };
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

    const summary = await dataRetention.runRetentionSweep();

    expect(summary).toEqual({ tenants: 2, purged: 10, skipped: 0, errors: 1 });
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ tenantId: "tenant-2", action: "DELETE" }),
    ]);
    require("../../models").Tenant = Tenant;
  });
});
