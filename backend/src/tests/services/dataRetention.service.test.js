const { Op } = require("sequelize");

jest.mock("../../models", () => {
  const mockUser = {
    findAll: jest.fn(),
    update: jest.fn(),
    rawAttributes: {
      id: { fieldName: "id", type: { key: "INTEGER" } },
      email: { fieldName: "email", type: { key: "STRING" } },
      createdAt: { fieldName: "createdAt", type: { key: "DATE" } },
    },
  };
  const mockAudit_log = {
    findAll: jest.fn(),
    update: jest.fn(),
    rawAttributes: {
      id: { fieldName: "id", type: { key: "INTEGER" } },
      ipAddress: { fieldName: "ipAddress", type: { key: "STRING" } },
    },
  };

  return {
    AuditLog: { destroy: jest.fn() },
    Notification: { destroy: jest.fn() },
    Session: { destroy: jest.fn() },
    Tenant: { findAll: jest.fn() },
    TenantSettings: {
      findOne: jest.fn(),
      findAll: jest.fn(),
      upsert: jest.fn(),
      destroy: jest.fn(),
    },
    User: mockUser,
    Audit_log: mockAudit_log,
  };
});

const dataRetention = require("../../services/dataRetention.service");
const { AuditLog, Notification, Session, Tenant, TenantSettings, User, Audit_log } = require("../../models");

describe("dataRetention.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getRetentionPolicy", () => {
    it("returns defaults when no overrides exist", async () => {
      TenantSettings.findAll.mockResolvedValue([]);
      const result = await dataRetention.getRetentionPolicy("t1");
      expect(result.audit_logs).toBe(365);
      expect(result.notifications).toBe(90);
    });

    it("returns custom policies when overrides exist", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_audit_logs", value: "180" },
      ]);
      const result = await dataRetention.getRetentionPolicy("t1");
      expect(result.audit_logs).toBe(180);
    });
  });

  describe("setRetentionPolicy", () => {
    it("updates retention days for a policy", async () => {
      TenantSettings.upsert.mockResolvedValue({});

      const result = await dataRetention.setRetentionPolicy("t1", "audit_logs", 180);

      expect(TenantSettings.upsert).toHaveBeenCalledWith({
        tenantId: "t1",
        key: "retention_policy_audit_logs",
        value: "180",
      });
      expect(result.days).toBe(180);
    });

    it("rejects unknown policy keys", async () => {
      await expect(dataRetention.setRetentionPolicy("t1", "unknown", 30)).rejects.toThrow();
    });

    it("rejects negative retention days", async () => {
      await expect(dataRetention.setRetentionPolicy("t1", "audit_logs", -5)).rejects.toThrow();
    });
  });

  describe("isOnLegalHold / enable / disable", () => {
    it("reports legal hold status", async () => {
      TenantSettings.findOne.mockResolvedValueOnce({ value: "true" });
      expect(await dataRetention.isOnLegalHold("t1")).toBe(true);

      TenantSettings.findOne.mockResolvedValueOnce(null);
      expect(await dataRetention.isOnLegalHold("t1")).toBe(false);
    });

    it("enables legal hold with reason", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      const result = await dataRetention.enableLegalHold("t1", "user-1", " litigation");
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe(" litigation");
    });

    it("stores a default reason when none is supplied", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      const result = await dataRetention.enableLegalHold("t1", "user-1");

      expect(TenantSettings.upsert).toHaveBeenCalledWith({
        tenantId: "t1",
        key: "legal_hold_reason",
        value: "Legal hold enabled",
      });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("disables legal hold", async () => {
      TenantSettings.destroy.mockResolvedValue(3);
      const result = await dataRetention.disableLegalHold("t1", "user-1");
      expect(result.enabled).toBe(false);
    });
  });

  describe("purgeExpiredRecords", () => {
    it("purges old records per policy", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      TenantSettings.findAll.mockResolvedValue([]);
      AuditLog.destroy.mockResolvedValue(5);
      Notification.destroy.mockResolvedValue(3);
      Session.destroy.mockResolvedValue(10);

      const result = await dataRetention.purgeExpiredRecords("t1");

      expect(result.purged.audit_logs).toBe(5);
      expect(result.purged.notifications).toBe(3);
      expect(result.purged.sessions).toBe(10);
    });

    it("skips purge when legal hold is active", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "true" });
      const result = await dataRetention.purgeExpiredRecords("t1");
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("legal_hold");
    });

    it("omits entities from the result when nothing was deleted", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      TenantSettings.findAll.mockResolvedValue([]);
      AuditLog.destroy.mockResolvedValue(0);
      Notification.destroy.mockResolvedValue(0);
      Session.destroy.mockResolvedValue(0);

      const result = await dataRetention.purgeExpiredRecords("t1");

      expect(result.skipped).toBe(false);
      expect(result.purged).toEqual({});
    });

    it("skips purge for an entity if retention days <= 0", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_audit_logs", value: "0" },
      ]);
      AuditLog.destroy.mockResolvedValue(0);

      const result = await dataRetention.purgeExpiredRecords("t1");
      expect(result.purged.audit_logs).toBeUndefined();
    });
  });

  describe("maskPII", () => {
    it("throws error when legal hold is active", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "true" });
      await expect(dataRetention.maskPII("t1", "users", [1])).rejects.toThrow("Cannot mask PII while legal hold is active");
    });

    it("throws error for unknown entity type", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      await expect(dataRetention.maskPII("t1", "unknown", [1])).rejects.toThrow("Unknown entity type for PII masking");
    });

    it("masks users fields with redacted values", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      User.update.mockResolvedValue([1]);

      const result = await dataRetention.maskPII("t1", "users", [1, 2]);

      expect(User.update).toHaveBeenCalledWith(
        {
          email: "[REDACTED]",
          firstName: "[REDACTED]",
          lastName: "[REDACTED]",
          phone: "[REDACTED]",
        },
        expect.any(Object)
      );
      expect(result.masked).toBe(2);
    });

    it("throws error when model not found", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const models = require("../../models");
      const originalUser = models.User;
      delete models.User;

      await expect(dataRetention.maskPII("t1", "users", [1])).rejects.toThrow("Model not found for entity type");
      
      models.User = originalUser;
    });
  });

  describe("anonymizeDataset", () => {
    it("throws error when legal hold is active", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "true" });
      await expect(dataRetention.anonymizeDataset("t1", "users")).rejects.toThrow("Cannot anonymize dataset while legal hold is active");
    });

    it("throws error when model not found", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const models = require("../../models");
      const originalUser = models.User;
      delete models.User;

      await expect(dataRetention.anonymizeDataset("t1", "users")).rejects.toThrow("Model not found for entity type");

      models.User = originalUser;
    });

    it("anonymizes fields in the dataset", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const mockRecord = {
        update: jest.fn().mockResolvedValue({}),
      };
      User.findAll.mockResolvedValue([mockRecord]);

      const result = await dataRetention.anonymizeDataset("t1", "users", {
        keepDates: false,
        keepNumericIds: false,
      });

      expect(mockRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "[ANONYMIZED]",
          createdAt: new Date("1970-01-01"),
          id: expect.any(String),
        })
      );
      expect(result.anonymized).toBe(1);
    });

    it("preserves ids and dates by default", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      const mockRecord = { update: jest.fn().mockResolvedValue({}) };
      User.findAll.mockResolvedValue([mockRecord]);

      const result = await dataRetention.anonymizeDataset("t1", "users");

      expect(mockRecord.update).toHaveBeenCalledWith({
        email: "[ANONYMIZED]",
      });
      const passed = mockRecord.update.mock.calls[0][0];
      expect(passed).not.toHaveProperty("id");
      expect(passed).not.toHaveProperty("createdAt");
      expect(result.anonymized).toBe(1);
    });
  });

  describe("runRetentionSweep", () => {
    afterEach(() => jest.restoreAllMocks());

    it("aggregates purged counts and skips across all tenants", async () => {
      Tenant.findAll.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
      const spy = jest
        .spyOn(dataRetention, "purgeExpiredRecords")
        .mockResolvedValueOnce({ purged: { audit_logs: 5, sessions: 2 }, skipped: false })
        .mockResolvedValueOnce({ skipped: true, reason: "legal_hold" });

      const summary = await dataRetention.runRetentionSweep();

      expect(spy).toHaveBeenCalledWith("t1");
      expect(spy).toHaveBeenCalledWith("t2");
      expect(summary).toEqual({ tenants: 2, purged: 7, skipped: 1, errors: 0 });
    });

    it("treats a missing purged map as zero", async () => {
      Tenant.findAll.mockResolvedValue([{ id: "t1" }]);
      jest
        .spyOn(dataRetention, "purgeExpiredRecords")
        .mockResolvedValue({ skipped: false });

      const summary = await dataRetention.runRetentionSweep();

      expect(summary).toEqual({ tenants: 1, purged: 0, skipped: 0, errors: 0 });
    });

    it("counts and logs a per-tenant failure without aborting the sweep", async () => {
      Tenant.findAll.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
      jest
        .spyOn(dataRetention, "purgeExpiredRecords")
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ purged: { sessions: 3 }, skipped: false });

      const summary = await dataRetention.runRetentionSweep();

      expect(summary).toEqual({ tenants: 2, purged: 3, skipped: 0, errors: 1 });
    });
  });
});
