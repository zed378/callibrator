/**
 * Tests for the GDPR service methods added to make the module functional:
 * updateConsent, getProcessingActivities, rectifyData, restrictProcessing.
 */
// archiver ships as ESM; it is only used by exportUserData (not exercised here).
jest.mock("archiver", () => jest.fn());
const mockTx = { id: "tx" };
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb(mockTx)) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/emailQueue.service", () => ({
  queueActivationEmail: jest.fn().mockResolvedValue(true),
  queueNotificationEmail: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../utils/jwt.util", () => ({ generatePurposeToken: jest.fn(() => "tok") }));
// A-214: an email change re-authenticates first (gdpr.rectifyReauth.a214.test.js).
jest.mock("../../services/auth.service", () => ({
  passwordManagedBy: jest.fn(async () => null),
  reauthenticate: jest.fn(async () => "password"),
}));
jest.mock("../../models", () => ({
  ConsentRecord: {
    create: jest.fn().mockResolvedValue({ id: "c-1" }),
    update: jest.fn().mockResolvedValue([1]),
    findAll: jest.fn().mockResolvedValue([]),
  },
  DsarRequest: { create: jest.fn().mockResolvedValue({ id: "dsar-1" }) },
  User: {
    update: jest.fn().mockResolvedValue([1]),
    // A-180: an email rectification reads the account and checks the address.
    findOne: jest.fn().mockResolvedValue({
      id: "u1",
      email: "jane.old@example.com",
      firstName: "Jane",
      lastName: "Doe",
    }),
    unscoped: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })),
  },
  AuditLog: { create: jest.fn().mockResolvedValue({}) },
}));

const gdpr = require("../../services/gdpr.service");
const { ConsentRecord, DsarRequest, User } = require("../../models");

describe("gdpr.service new methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // isGdprEnabled() reads process.env at call time: anything other than the
    // literal "false" means enabled.
    process.env.GDPR_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.GDPR_ENABLED;
  });

  describe("GDPR kill switch", () => {
    // Each entry-point guards on isGdprEnabled() and 400s with its own message.
    it.each([
      ["updateConsent", () => gdpr.updateConsent("t1", "u1", ["analytics"], true), "Consent management is disabled"],
      ["rectifyData", () => gdpr.rectifyData("t1", "u1", "firstName", "Jane"), "Rectification is disabled"],
      ["restrictProcessing", () => gdpr.restrictProcessing("t1", "u1", "reason"), "Processing restriction is disabled"],
    ])("%s rejects with 400 when GDPR_ENABLED=false", async (_name, invoke, message) => {
      process.env.GDPR_ENABLED = "false";

      await expect(invoke()).rejects.toMatchObject({ status: 400, message });
      expect(ConsentRecord.create).not.toHaveBeenCalled();
      expect(User.update).not.toHaveBeenCalled();
    });
  });

  describe("updateConsent", () => {
    it("grants each category when consent=true", async () => {
      const res = await gdpr.updateConsent("t1", "u1", ["analytics", "marketing"], true, "1.2.3.4");
      expect(ConsentRecord.create).toHaveBeenCalledTimes(2);
      expect(res).toEqual({ updated: 2, consent: true, categories: ["analytics", "marketing"] });
    });

    it("withdraws each category when consent=false", async () => {
      await gdpr.updateConsent("t1", "u1", ["analytics"], false);
      expect(ConsentRecord.update).toHaveBeenCalledTimes(1);
      expect(ConsentRecord.create).not.toHaveBeenCalled();
    });

    it("rejects an empty category list", async () => {
      await expect(gdpr.updateConsent("t1", "u1", [], true)).rejects.toMatchObject({ status: 400 });
    });

    it("rejects a non-boolean consent", async () => {
      await expect(gdpr.updateConsent("t1", "u1", ["x"], "yes")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("getProcessingActivities", () => {
    it("returns an Article 30 disclosure", async () => {
      const res = await gdpr.getProcessingActivities("t1", "u1");
      expect(Array.isArray(res.activities)).toBe(true);
      expect(res.activities.length).toBeGreaterThan(0);
      expect(res.subjectId).toBe("u1");
    });
  });

  describe("rectifyData", () => {
    it("updates a whitelisted field and audits it in the same transaction", async () => {
      const auditService = require("../../services/audit.service");
      const res = await gdpr.rectifyData("t1", "u1", "firstName", "Jane", {
        ipAddress: "10.0.0.1",
        userAgent: "ua",
      });
      expect(User.update).toHaveBeenCalledWith(
        { firstName: "Jane" },
        { where: { id: "u1", tenantId: "t1" }, transaction: mockTx },
      );
      expect(auditService.logAction).toHaveBeenCalledWith(
        {
          tenantId: "t1",
          userId: "u1",
          action: "UPDATE",
          resourceType: "User",
          resourceId: "u1",
          changes: { operation: "GDPR_RECTIFICATION", fields: ["firstName"] },
          ipAddress: "10.0.0.1",
          userAgent: "ua",
        },
        { transaction: mockTx },
      );
      expect(res).toEqual({ rectified: true, field: "firstName" });
    });

    it("A-153: never writes the new value into the permanent audit trail", async () => {
      const auditService = require("../../services/audit.service");

      await gdpr.rectifyData("t1", "u1", "email", "jane.private@example.com");

      const [entry] = auditService.logAction.mock.calls[0];
      expect(JSON.stringify(entry)).not.toContain("jane.private@example.com");
      expect(entry.ipAddress).toBeNull();
      expect(entry.userAgent).toBeNull();
    });

    it("rejects a non-whitelisted field", async () => {
      await expect(gdpr.rectifyData("t1", "u1", "roleId", "admin")).rejects.toMatchObject({ status: 400 });
      expect(User.update).not.toHaveBeenCalled();
    });

    it("404s when the user does not exist, and writes no audit row", async () => {
      const auditService = require("../../services/audit.service");
      User.update.mockResolvedValueOnce([0]);
      await expect(gdpr.rectifyData("t1", "u1", "phone", "123")).rejects.toMatchObject({ status: 404 });
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    it("A-153: a failed audit write fails the rectification (it rolls back)", async () => {
      const auditService = require("../../services/audit.service");
      auditService.logAction.mockRejectedValueOnce(new Error("audit table down"));

      await expect(
        gdpr.rectifyData("t1", "u1", "email", "jane@example.com"),
      ).rejects.toThrow("audit table down");
    });
  });

  describe("restrictProcessing", () => {
    it("records a restriction DSAR", async () => {
      const res = await gdpr.restrictProcessing("t1", "u1", "no marketing");
      expect(DsarRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", userId: "u1", type: "restriction" }),
        { transaction: mockTx },
      );
      expect(res).toMatchObject({ restricted: true, requestId: "dsar-1" });
    });

    it("records a null reason when none is given", async () => {
      await gdpr.restrictProcessing("t1", "u1");

      expect(DsarRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t1",
          userId: "u1",
          type: "restriction",
          details: { reason: null },
        }),
        { transaction: mockTx },
      );
    });
  });

  // P6-11 — the evidence of how a data-subject request was handled is itself
  // an audit row, in the same transaction, without the personal data.
  describe("P6-11 — audit rows", () => {
    const auditService = require("../../services/audit.service");
    const principal = { userId: "u1", apiKeyId: null, ipAddress: "10.0.0.1", userAgent: "jest" };
    const entries = () => auditService.logAction.mock.calls.map(([entry, options]) => ({ entry, options }));

    it("updateConsent writes one row per purpose, granted or withdrawn, in its transaction", async () => {
      await gdpr.updateConsent("t1", "u1", ["analytics", "marketing"], true, "10.0.0.1", principal);
      await gdpr.updateConsent("t1", "u1", ["analytics"], false, "10.0.0.1", principal);
      const rows = entries();
      expect(rows).toHaveLength(3);
      for (const { options } of rows) {
        expect(options).toEqual({ transaction: mockTx });
      }
      expect(rows.map(({ entry }) => entry.changes.operation)).toEqual([
        "GDPR_CONSENT_GRANT",
        "GDPR_CONSENT_GRANT",
        "GDPR_CONSENT_WITHDRAW",
      ]);
      expect(rows[0].entry).toMatchObject({
        tenantId: "t1",
        userId: "u1",
        ipAddress: "10.0.0.1",
        action: "CREATE",
        resourceType: "ConsentRecord",
        resourceId: "c-1",
        changes: { purpose: "analytics", version: "1.0", subjectId: "u1" },
      });
      expect(rows[2].entry.changes).toMatchObject({ purpose: "analytics", withdrawn: 1 });
    });

    it("without a principal the subject is the actor", async () => {
      await gdpr.recordConsent("t1", "u1", "analytics");
      expect(entries()[0].entry).toMatchObject({ userId: "u1" });
    });

    it("a restriction's row records the request type, never the free-text reason", async () => {
      await gdpr.restrictProcessing("t1", "u1", "my health condition", principal);
      const [{ entry }] = entries();
      expect(entry).toMatchObject({
        resourceType: "DsarRequest",
        resourceId: "dsar-1",
        changes: { operation: "GDPR_DSAR_CREATE", type: "restriction", hasDetails: true },
      });
      expect(JSON.stringify(entry)).not.toContain("health");
    });

    it("an erasure request with no details records hasDetails: false", async () => {
      await gdpr.createDsar("t1", "u1", "erasure", { reason: null });
      expect(entries()[0].entry.changes).toMatchObject({ type: "erasure", hasDetails: false });
      await gdpr.createDsar("t1", "u1", "export", undefined);
      expect(entries()[1].entry.changes).toMatchObject({ type: "export", hasDetails: false });
      await gdpr.createDsar("t1", "u1", "export", null);
      expect(entries()[2].entry.changes).toMatchObject({ hasDetails: false });
      await gdpr.createDsar("t1", "u1", "export", { reason: undefined });
      expect(entries()[3].entry.changes).toMatchObject({ hasDetails: false });
    });

    // A-333: the privacy-preferences pair was removed (it audited a write
    // to an attribute User does not have).

    it("a failed audit write fails the request (it cannot be granted unrecorded)", async () => {
      auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));
      await expect(gdpr.recordConsent("t1", "u1", "analytics", "1.0", "", principal)).rejects.toMatchObject({
        status: 500,
      });
    });
  });
});
