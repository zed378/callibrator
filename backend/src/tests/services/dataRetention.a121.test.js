/**
 * A-121 — audit rows are never purged (ADR-051 Q-10, Q-12; F-4, F-5).
 *
 * - The retention purge has no path that destroys an `audit_logs` row: not the
 *   default policy, not a stored `retention_policy_audit_logs` override written
 *   before this change, and not the second engine `gdpr.service` used to carry.
 * - `setRetentionPolicy` refuses `audit_logs` as an entity, refuses a period
 *   below the per-entity floor, and refuses a policy with no tenant.
 * - (`data_retention_policies` itself is dropped by migration 0047, A-137.)
 */

// gdpr.service is loaded only to assert what it no longer exports; archiver is
// ESM and cannot be required under Jest's CommonJS runtime.
jest.mock("archiver", () => jest.fn());
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models", () => ({
  AuditLog: { destroy: jest.fn().mockResolvedValue(42) },
  Notification: { destroy: jest.fn().mockResolvedValue(0) },
  Session: { destroy: jest.fn().mockResolvedValue(0) },
  Tenant: { findAll: jest.fn() },
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(),
  },
}));

const dataRetention = require("../../services/dataRetention.service");
const { AuditLog, Tenant, TenantSettings } = require("../../models");

describe("A-121 — audit rows are never purged", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TenantSettings.findOne.mockResolvedValue(null); // no legal hold
    TenantSettings.findAll.mockResolvedValue([]);
  });

  describe("the retention purge never deletes an audit row", () => {
    it("with the platform defaults", async () => {
      const result = await dataRetention.purgeExpiredRecords("tenant-1");

      expect(AuditLog.destroy).not.toHaveBeenCalled();
      expect(result.purged).not.toHaveProperty("audit_logs");
    });

    it("with a retention_policy_audit_logs override stored before this change", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_audit_logs", value: "1" },
      ]);

      const result = await dataRetention.purgeExpiredRecords("tenant-1");

      expect(AuditLog.destroy).not.toHaveBeenCalled();
      expect(result.purged).not.toHaveProperty("audit_logs");
    });

    it("across the nightly sweep of every tenant", async () => {
      Tenant.findAll.mockResolvedValue([{ id: "tenant-1" }, { id: "tenant-2" }]);
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_audit_logs", value: "1" },
      ]);

      await dataRetention.runRetentionSweep();

      expect(AuditLog.destroy).not.toHaveBeenCalled();
    });

    it("does not report audit_logs as a configured retention period", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_audit_logs", value: "30" },
      ]);

      const policy = await dataRetention.getRetentionPolicy("tenant-1");

      expect(policy).not.toHaveProperty("audit_logs");
    });

    it("the second purge engine in gdpr.service no longer exists (F-4)", () => {
      const gdpr = jest.requireActual("../../services/gdpr.service");

      expect(gdpr.enforceDataRetention).toBeUndefined();
      expect(gdpr.purgeExpiredData).toBeUndefined();
    });
  });

  describe("a retention policy for audit_logs is refused", () => {
    it.each([365, 3650, 0])("for %i days, with a 400 and nothing written", async (days) => {
      await expect(
        dataRetention.setRetentionPolicy("tenant-1", "audit_logs", days),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/audit logs are not subject to retention/i),
      });
      expect(TenantSettings.upsert).not.toHaveBeenCalled();
    });
  });

  describe("a policy below the minimum is refused", () => {
    it.each([
      ["notifications", 29, 30],
      ["sessions", 1, 30],
    ])("%s at %i days (floor %i)", async (entity, days, floor) => {
      await expect(
        dataRetention.setRetentionPolicy("tenant-1", entity, days),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining(`at least ${floor} days`),
      });
      expect(TenantSettings.upsert).not.toHaveBeenCalled();
    });

    it("accepts a period at the floor", async () => {
      await dataRetention.setRetentionPolicy("tenant-1", "notifications", 30);

      expect(TenantSettings.upsert).toHaveBeenCalledWith(
        {
          tenantId: "tenant-1",
          key: "retention_policy_notifications",
          value: "30",
        },
        { transaction: expect.anything() },
      );
    });

    it("accepts 0, which means keep forever", async () => {
      await dataRetention.setRetentionPolicy("tenant-1", "sessions", 0);

      expect(TenantSettings.upsert).toHaveBeenCalledWith(
        {
          tenantId: "tenant-1",
          key: "retention_policy_sessions",
          value: "0",
        },
        { transaction: expect.anything() },
      );
    });
  });

  describe("a global retention policy cannot be created", () => {
    it.each([null, undefined, ""])(
      "setRetentionPolicy with tenant %p answers 400 and writes nothing",
      async (tenantId) => {
        await expect(
          dataRetention.setRetentionPolicy(tenantId, "notifications", 90),
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/per tenant/i),
        });
        expect(TenantSettings.upsert).not.toHaveBeenCalled();
      },
    );
  });
});
