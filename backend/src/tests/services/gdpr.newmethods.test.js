/**
 * Tests for the GDPR service methods added to make the module functional:
 * updateConsent, getProcessingActivities, rectifyData, restrictProcessing.
 */
// archiver ships as ESM; it is only used by exportUserData (not exercised here).
jest.mock("archiver", () => jest.fn());
jest.mock("../../config", () => ({ db: {} }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../models", () => ({
  ConsentRecord: {
    create: jest.fn().mockResolvedValue({ id: "c-1" }),
    update: jest.fn().mockResolvedValue([1]),
    findAll: jest.fn().mockResolvedValue([]),
  },
  DsarRequest: { create: jest.fn().mockResolvedValue({ id: "dsar-1" }) },
  User: { update: jest.fn().mockResolvedValue([1]) },
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
    it("updates a whitelisted field and audits it", async () => {
      const res = await gdpr.rectifyData("t1", "u1", "firstName", "Jane");
      expect(User.update).toHaveBeenCalledWith(
        { firstName: "Jane" },
        { where: { id: "u1", tenantId: "t1" } },
      );
      expect(res).toEqual({ rectified: true, field: "firstName" });
    });

    it("rejects a non-whitelisted field", async () => {
      await expect(gdpr.rectifyData("t1", "u1", "roleId", "admin")).rejects.toMatchObject({ status: 400 });
      expect(User.update).not.toHaveBeenCalled();
    });

    it("404s when the user does not exist", async () => {
      User.update.mockResolvedValueOnce([0]);
      await expect(gdpr.rectifyData("t1", "u1", "phone", "123")).rejects.toMatchObject({ status: 404 });
    });

    it("still reports success when the audit write fails", async () => {
      // The audit trail is best-effort: a failure must not undo the rectification.
      const { AuditLog } = require("../../models");
      const { logger } = require("../../middlewares/activityLog.middleware");
      AuditLog.create.mockRejectedValueOnce(new Error("audit table down"));

      const res = await gdpr.rectifyData("t1", "u1", "email", "jane@example.com");

      expect(res).toEqual({ rectified: true, field: "email" });
      expect(logger.warn).toHaveBeenCalledWith("Failed to audit rectification", {
        error: "audit table down",
      });
    });
  });

  describe("restrictProcessing", () => {
    it("records a restriction DSAR", async () => {
      const res = await gdpr.restrictProcessing("t1", "u1", "no marketing");
      expect(DsarRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", userId: "u1", type: "restriction" }),
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
      );
    });
  });
});
