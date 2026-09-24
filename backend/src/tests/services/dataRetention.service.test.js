const { Op } = require("sequelize");

// W-04: the purge runs in a managed transaction and records itself through
// logAction. Its in-transaction effects are asserted against a
// schema-enforcing ledger in dataRetention.audit.w04.test.js.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
// A-180: a masked account's photo file is deleted after the commit.
jest.mock("../../utils/upload.util", () => ({ deleteUpload: jest.fn().mockResolvedValue(true) }));

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
  // A-135: there is no `Audit_log` model. This mock used to invent one, so
  // the tests passed while maskPII("audit_logs") answered 400 on every real
  // call. Audit-row masking is tested against the real models in
  // dataRetention.maskAudit.a135.test.js.

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
  };
});

const dataRetention = require("../../services/dataRetention.service");
const { AuditLog, Notification, Session, Tenant, TenantSettings, User } = require("../../models");
const auditService = require("../../services/audit.service");

describe("dataRetention.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getRetentionPolicy", () => {
    it("returns defaults when no overrides exist", async () => {
      TenantSettings.findAll.mockResolvedValue([]);
      const result = await dataRetention.getRetentionPolicy("t1");
      // A-121: audit_logs is not a purgeable entity.
      expect(result).toEqual({ notifications: 90, sessions: 30 });
    });

    it("returns custom policies when overrides exist", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_notifications", value: "180" },
      ]);
      const result = await dataRetention.getRetentionPolicy("t1");
      expect(result.notifications).toBe(180);
    });
  });

  describe("setRetentionPolicy", () => {
    it("updates retention days for a policy", async () => {
      TenantSettings.upsert.mockResolvedValue({});

      TenantSettings.findOne.mockResolvedValueOnce({ value: "90" });

      const result = await dataRetention.setRetentionPolicy("t1", "notifications", 180, {
        userId: "admin-1",
        ipAddress: "10.0.0.1",
        userAgent: "ua",
      });

      expect(TenantSettings.upsert).toHaveBeenCalledWith(
        { tenantId: "t1", key: "retention_policy_notifications", value: "180" },
        { transaction: "TX" },
      );
      // A-153: audited in the same transaction, with the period before and after.
      expect(auditService.logAction).toHaveBeenCalledWith(
        {
          tenantId: "t1",
          userId: "admin-1",
          ipAddress: "10.0.0.1",
          userAgent: "ua",
          action: "UPDATE",
          resourceType: "DataRetention",
          resourceId: "t1",
          changes: {
            operation: "SET_RETENTION_POLICY",
            policyKey: "notifications",
            before: { days: 90 },
            after: { days: 180 },
          },
        },
        { transaction: "TX" },
      );
      expect(result.days).toBe(180);
    });

    it("records a first override as replacing the platform default (before: null)", async () => {
      TenantSettings.findOne.mockResolvedValueOnce(null);

      await dataRetention.setRetentionPolicy("t1", "sessions", 60);

      const [entry] = auditService.logAction.mock.calls[0];
      expect(entry.changes.before).toEqual({ days: null });
      expect(entry.userId).toBeNull();
    });

    it("a failed audit row fails the change (A-153)", async () => {
      auditService.logAction.mockRejectedValueOnce(new Error("audit down"));

      await expect(dataRetention.setRetentionPolicy("t1", "sessions", 60)).rejects.toThrow(
        "audit down",
      );
    });

    it("rejects unknown policy keys", async () => {
      await expect(dataRetention.setRetentionPolicy("t1", "unknown", 30)).rejects.toThrow();
    });

    it("rejects negative retention days", async () => {
      await expect(dataRetention.setRetentionPolicy("t1", "sessions", -5)).rejects.toThrow();
    });
  });

  describe("isOnLegalHold / enable / disable", () => {
    it("reports legal hold status", async () => {
      TenantSettings.findOne.mockResolvedValueOnce({ value: "true" });
      expect(await dataRetention.isOnLegalHold("t1")).toBe(true);

      TenantSettings.findOne.mockResolvedValueOnce(null);
      expect(await dataRetention.isOnLegalHold("t1")).toBe(false);
    });

    const ACTOR = { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "ua" };

    it("enables legal hold with reason, audited in the same transaction (A-153)", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      TenantSettings.findOne.mockResolvedValueOnce(null);

      const result = await dataRetention.enableLegalHold("t1", ACTOR, " litigation");

      expect(result).toEqual({ tenantId: "t1", enabled: true, reason: " litigation", enabledBy: "user-1" });
      expect(TenantSettings.upsert.mock.calls).toEqual([
        [{ tenantId: "t1", key: "legal_hold_enabled", value: "true" }, { transaction: "TX" }],
        [{ tenantId: "t1", key: "legal_hold_reason", value: " litigation" }, { transaction: "TX" }],
        [{ tenantId: "t1", key: "legal_hold_enabled_by", value: "user-1" }, { transaction: "TX" }],
      ]);
      expect(auditService.logAction).toHaveBeenCalledWith(
        {
          tenantId: "t1",
          userId: "user-1",
          ipAddress: "10.0.0.1",
          userAgent: "ua",
          action: "UPDATE",
          resourceType: "LegalHold",
          resourceId: "t1",
          changes: {
            operation: "LEGAL_HOLD_ENABLE",
            before: { onHold: false },
            after: { onHold: true, reason: " litigation" },
          },
        },
        { transaction: "TX" },
      );
    });

    it("stores a default reason when none is supplied, and records a hold already in force", async () => {
      TenantSettings.upsert.mockResolvedValue({});
      TenantSettings.findOne.mockResolvedValueOnce({ value: "true" });
      const result = await dataRetention.enableLegalHold("t1", { userId: "user-1" });

      expect(TenantSettings.upsert).toHaveBeenCalledWith(
        { tenantId: "t1", key: "legal_hold_reason", value: "Legal hold enabled" },
        { transaction: "TX" },
      );
      const [entry] = auditService.logAction.mock.calls[0];
      expect(entry.changes.before).toEqual({ onHold: true });
      expect(entry.ipAddress).toBeNull();
      expect(result.enabled).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("disables legal hold, audited with the reason it was placed for (A-153)", async () => {
      TenantSettings.findOne.mockResolvedValueOnce({ value: "litigation" });
      TenantSettings.destroy.mockResolvedValue(3);

      const result = await dataRetention.disableLegalHold("t1", ACTOR);

      expect(result).toEqual({ tenantId: "t1", enabled: false, disabledBy: "user-1" });
      expect(TenantSettings.destroy).toHaveBeenCalledWith({
        where: {
          tenantId: "t1",
          key: ["legal_hold_enabled", "legal_hold_reason", "legal_hold_enabled_by"],
        },
        transaction: "TX",
      });
      expect(auditService.logAction.mock.calls[0][0].changes).toEqual({
        operation: "LEGAL_HOLD_RELEASE",
        before: { onHold: true, reason: "litigation" },
        after: { onHold: false },
      });
      expect(auditService.logAction.mock.calls[0][1]).toEqual({ transaction: "TX" });
    });

    it("releasing when no hold is in force records that", async () => {
      TenantSettings.findOne.mockResolvedValueOnce(null);
      TenantSettings.destroy.mockResolvedValue(0);

      await dataRetention.disableLegalHold("t1", ACTOR);

      expect(auditService.logAction.mock.calls[0][0].changes.before).toEqual({
        onHold: false,
        reason: null,
      });
    });

    it("a failed audit row fails the hold change (it rolls back)", async () => {
      auditService.logAction.mockRejectedValueOnce(new Error("audit down"));

      await expect(dataRetention.enableLegalHold("t1", ACTOR, "x")).rejects.toThrow("audit down");
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

      expect(result.purged).toEqual({ notifications: 3, sessions: 10 });
      expect(AuditLog.destroy).not.toHaveBeenCalled();
    });

    it("never purges sooner than an entity's floor, whatever is stored", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_notifications", value: "1" },
      ]);
      Notification.destroy.mockResolvedValue(0);
      Session.destroy.mockResolvedValue(0);

      await dataRetention.purgeExpiredRecords("t1");

      const cutoff = Notification.destroy.mock.calls[0][0].where.createdAt[Op.lt];
      const ageDays = (Date.now() - cutoff.getTime()) / 86400000;
      expect(Math.round(ageDays)).toBe(30);
    });

    it("keeps an entity whose stored period does not parse", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      TenantSettings.findAll.mockResolvedValue([
        { key: "retention_policy_sessions", value: "forever" },
      ]);
      Notification.destroy.mockResolvedValue(0);

      await dataRetention.purgeExpiredRecords("t1");

      expect(Session.destroy).not.toHaveBeenCalled();
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
        { key: "retention_policy_sessions", value: "0" },
      ]);
      Notification.destroy.mockResolvedValue(0);

      const result = await dataRetention.purgeExpiredRecords("t1");
      expect(Session.destroy).not.toHaveBeenCalled();
      expect(result.purged.sessions).toBeUndefined();
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

    it("masks each user in one transaction with a unique, valid email, and audits it", async () => {
      // A-135: a single shared "[REDACTED]" email failed the model's isEmail
      // validation, and would collide on the unique index from the 2nd row.
      TenantSettings.findOne.mockResolvedValue(null);
      User.findAll.mockResolvedValue([{ id: "u1", avatarUrl: "default.svg" }]);
      User.update.mockResolvedValueOnce([1]).mockResolvedValueOnce([0]);

      const result = await dataRetention.maskPII("t1", "users", ["u1", "u2"], {
        userId: "admin-1",
        ipAddress: "10.0.0.1",
        userAgent: "ua",
      });

      expect(User.update).toHaveBeenNthCalledWith(
        1,
        {
          email: "redacted_u1@redacted.invalid",
          // A-180: the username and the avatar reference are masked too.
          username: "redacted_u1",
          firstName: "[REDACTED]",
          lastName: "[REDACTED]",
          phone: "[REDACTED]",
          avatarUrl: "default.svg",
        },
        { where: { id: "u1", tenantId: "t1" }, transaction: "TX" },
      );
      expect(User.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ email: "redacted_u2@redacted.invalid" }),
        { where: { id: "u2", tenantId: "t1" }, transaction: "TX" },
      );
      // The count is what the database changed, not what was asked for.
      expect(result).toEqual({ masked: 1, fields: ["email", "username", "firstName", "lastName", "phone", "avatarUrl"] });
      expect(auditService.logAction).toHaveBeenCalledWith(
        {
          tenantId: "t1",
          userId: "admin-1",
          action: "UPDATE",
          resourceType: "User",
          resourceId: null,
          changes: {
            operation: "GDPR_MASK_PII",
            recordIds: ["u1", "u2"],
            masked: 1,
            fields: ["email", "username", "firstName", "lastName", "phone", "avatarUrl"],
          },
          ipAddress: "10.0.0.1",
          userAgent: "ua",
        },
        { transaction: "TX" },
      );
    });

    it("records null request-origin fields when no actor detail is given", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      User.findAll.mockResolvedValue([]);
      User.update.mockResolvedValue([1]);

      await dataRetention.maskPII("t1", "users", ["u1"]);

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null, ipAddress: null, userAgent: null }),
        { transaction: "TX" },
      );
    });

    it("A-180: reads the accounts' avatars in the tenant, in the transaction, and deletes each photo file only after the commit", async () => {
      const { db } = require("../../config");
      const { deleteUpload } = require("../../utils/upload.util");
      const order = [];
      db.transaction.mockImplementationOnce(async (cb) => {
        const out = await cb("TX");
        order.push("commit");
        return out;
      });
      deleteUpload.mockImplementation(async (file) => order.push(`delete ${file}`));
      TenantSettings.findOne.mockResolvedValue(null);
      User.findAll.mockResolvedValue([
        { id: "u1", avatarUrl: "u1-photo.png" },
        { id: "u2", avatarUrl: "http://host/uploads/public/profile/u2-photo.jpg" },
        { id: "u3", avatarUrl: "default.svg" },
        { id: "u4", avatarUrl: null },
      ]);
      User.update.mockResolvedValue([1]);

      await dataRetention.maskPII("t1", "users", ["u1", "u2", "u3", "u4"], { userId: "admin-1" });

      expect(User.findAll).toHaveBeenCalledWith({
        where: { id: ["u1", "u2", "u3", "u4"], tenantId: "t1" },
        attributes: ["id", "avatarUrl"],
        transaction: "TX",
      });
      // The shared "no photo" placeholder and a null avatar are never deleted.
      expect(order).toEqual(["commit", "delete u1-photo.png", "delete u2-photo.jpg"]);
      expect(deleteUpload).toHaveBeenCalledWith("u1-photo.png", "uploads/public/profile");
    });

    it("A-180: a photo file that cannot be deleted is logged; the masking stands", async () => {
      const { deleteUpload } = require("../../utils/upload.util");
      const { logger } = require("../../middlewares/activityLog.middleware");
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
      deleteUpload.mockRejectedValueOnce(new Error("EACCES"));
      TenantSettings.findOne.mockResolvedValue(null);
      User.findAll.mockResolvedValue([{ id: "u1", avatarUrl: "u1-photo.png" }]);
      User.update.mockResolvedValue([1]);

      const result = await dataRetention.maskPII("t1", "users", ["u1"], { userId: "admin-1" });

      expect(result.masked).toBe(1);
      expect(warn).toHaveBeenCalledWith("Failed to delete a masked user's avatar file", {
        tenantId: "t1",
        error: "EACCES",
      });
      warn.mockRestore();
    });

    it("A-180: a rolled-back masking deletes no photo file", async () => {
      const { deleteUpload } = require("../../utils/upload.util");
      TenantSettings.findOne.mockResolvedValue(null);
      User.findAll.mockResolvedValue([{ id: "u1", avatarUrl: "u1-photo.png" }]);
      User.update.mockResolvedValue([1]);
      auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

      await expect(
        dataRetention.maskPII("t1", "users", ["u1"], { userId: "admin-1" }),
      ).rejects.toThrow("audit insert failed");
      expect(deleteUpload).not.toHaveBeenCalled();
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

  describe("anonymizeDataset (A-152: refused)", () => {
    it.each(["users", "notifications", "calibrationRecords", "anything"])(
      "%s is refused with 400 and nothing is read or written",
      async (entityType) => {
        await expect(dataRetention.anonymizeDataset("t1", entityType)).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining("mask-pii"),
        });
        expect(User.findAll).not.toHaveBeenCalled();
        expect(User.update).not.toHaveBeenCalled();
        expect(TenantSettings.findOne).not.toHaveBeenCalled();
      },
    );
  });

  describe("runRetentionSweep", () => {
    afterEach(() => jest.restoreAllMocks());

    it("aggregates purged counts and skips across all tenants", async () => {
      Tenant.findAll.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
      const spy = jest
        .spyOn(dataRetention, "purgeExpiredRecords")
        .mockResolvedValueOnce({ purged: { notifications: 5, sessions: 2 }, skipped: false })
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
