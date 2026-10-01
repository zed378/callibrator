jest.mock("../../models", () => ({
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(() => Promise.resolve([{}, true])),
    bulkCreate: jest.fn(),
    destroy: jest.fn(),
  },
}));

// P6-11: a flag change and its audit rows commit in one managed transaction.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb) => cb("txn")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(),
}));

const featureFlag = require("../../services/featureFlag.service");
const { TenantSettings } = require("../../models");

describe("featureFlag.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("isEnabled", () => {
    it("returns tenant override when set", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "true" });
      expect(await featureFlag.isEnabled("t1", "enable_iot")).toBe(true);
    });

    it("falls back to default when no tenant override", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      expect(await featureFlag.isEnabled("t1", "enable_iot")).toBe(true);
    });

    it("accepts a boolean-true override value, not just the string", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: true });
      expect(await featureFlag.isEnabled("t1", "enable_mfa")).toBe(true);
    });

    it("treats any other stored override value as disabled", async () => {
      TenantSettings.findOne.mockResolvedValue({ value: "false" });
      expect(await featureFlag.isEnabled("t1", "enable_iot")).toBe(false);
    });

    it("returns false for unknown flags", async () => {
      TenantSettings.findOne.mockResolvedValue(null);
      expect(await featureFlag.isEnabled("t1", "unknown_flag")).toBe(false);
    });
  });

  describe("getTenantFlags", () => {
    it("returns merged flags with defaults and overrides", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { key: "feature_flag_enable_mfa", value: "true" },
      ]);
      const result = await featureFlag.getTenantFlags("t1");
      expect(result.enable_mfa.enabled).toBe(true);
      expect(result.enable_mfa.tenantOverride).toBe(true);
      expect(result.enable_iot.enabled).toBe(true);
    });

    it("accepts boolean-true override values and marks others disabled", async () => {
      TenantSettings.findAll.mockResolvedValue([
        { key: "feature_flag_enable_mfa", value: true },
        { key: "feature_flag_enable_iot", value: "false" },
      ]);
      const result = await featureFlag.getTenantFlags("t1");
      expect(result.enable_mfa.enabled).toBe(true);
      expect(result.enable_mfa.tenantOverride).toBe(true);
      expect(result.enable_iot.enabled).toBe(false);
      expect(result.enable_iot.tenantOverride).toBe(true);
    });
  });

  describe("setTenantFlag", () => {
    it("sets a flag override", async () => {
      TenantSettings.upsert.mockResolvedValue([{}, true]);
      const result = await featureFlag.setTenantFlag("t1", "enable_mfa", true, "user-1");
      expect(TenantSettings.upsert).toHaveBeenCalledWith({
        tenantId: "t1",
        key: "feature_flag_enable_mfa",
        value: "true",
        updatedBy: "user-1",
      }, { transaction: "txn" });
      expect(result.enabled).toBe(true);
    });

    it("persists 'false' when disabling a flag", async () => {
      TenantSettings.upsert.mockResolvedValue([{}, false]);
      const result = await featureFlag.setTenantFlag("t1", "enable_iot", false, "user-1");
      expect(TenantSettings.upsert).toHaveBeenCalledWith({
        tenantId: "t1",
        key: "feature_flag_enable_iot",
        value: "false",
        updatedBy: "user-1",
      }, { transaction: "txn" });
      expect(result.enabled).toBe(false);
      expect(result.created).toBe(false);
    });

    it("throws for unknown flags", async () => {
      expect(featureFlag.setTenantFlag("t1", "unknown_flag", true)).rejects.toThrow();
    });
  });

  describe("resetTenantFlag", () => {
    it("removes tenant override and returns default", async () => {
      TenantSettings.destroy.mockResolvedValue(1);
      const result = await featureFlag.resetTenantFlag("t1", "enable_mfa");
      expect(TenantSettings.destroy).toHaveBeenCalledWith({
        where: { tenantId: "t1", key: "feature_flag_enable_mfa" },
        transaction: "txn",
      });
      expect(result.reset).toBe(true);
    });

    it("reports defaultValue false for an unknown flag with nothing to delete", async () => {
      TenantSettings.destroy.mockResolvedValue(0);
      const result = await featureFlag.resetTenantFlag("t1", "unknown_flag");
      expect(result).toEqual({
        flagKey: "unknown_flag",
        reset: false,
        defaultValue: false,
      });
    });
  });

  describe("initializeTenantFlags", () => {
    it("bulk-creates default-enabled flags", async () => {
      TenantSettings.bulkCreate.mockResolvedValue([]);
      await featureFlag.initializeTenantFlags("t1");
      expect(TenantSettings.bulkCreate).toHaveBeenCalled();
      const call = TenantSettings.bulkCreate.mock.calls[0][0];
      expect(call.some((c) => c.key === "feature_flag_enable_iot")).toBe(true);
    });
  });

  // P6-11 (A-165 shape): a platform operator's change to one tenant is audited
  // under PLATFORM and under that tenant, in the change's transaction.
  describe("P6-11 — audit rows", () => {
    const auditService = require("../../services/audit.service");
    const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
    const principal = { userId: "sa-1", apiKeyId: null, ipAddress: "10.0.0.1", userAgent: "jest" };

    it("setTenantFlag writes a PLATFORM row and a tenant row with the value before and after", async () => {
      TenantSettings.findOne.mockResolvedValueOnce({ value: "false" });
      TenantSettings.upsert.mockResolvedValue([{}, false]);
      await featureFlag.setTenantFlag("t1", "enable_mfa", true, "sa-1", principal);
      expect(auditService.logAction).toHaveBeenCalledTimes(2);
      const tenants = auditService.logAction.mock.calls.map(([entry]) => entry.tenantId);
      expect(tenants).toEqual([PLATFORM_TENANT_ID, "t1"]);
      for (const [entry, options] of auditService.logAction.mock.calls) {
        expect(options).toEqual({ transaction: "txn" });
        expect(entry).toMatchObject({
          userId: "sa-1",
          action: "UPDATE",
          resourceType: "Tenant",
          resourceId: "t1",
          changes: { operation: "FEATURE_FLAG_SET", flagKey: "enable_mfa", before: "false", after: "true" },
        });
      }
    });

    it("without a principal the row names the updating user; no stored value is null", async () => {
      TenantSettings.findOne.mockResolvedValueOnce(null);
      TenantSettings.upsert.mockResolvedValue([{}, true]);
      await featureFlag.setTenantFlag("t1", "enable_mfa", false, "user-9");
      expect(auditService.logAction.mock.calls[0][0]).toMatchObject({
        userId: "user-9",
        changes: { before: null, after: "false" },
      });
    });

    it("resetTenantFlag audits a removed override, and writes nothing when there was none", async () => {
      TenantSettings.findOne.mockResolvedValueOnce({ value: "true" });
      TenantSettings.destroy.mockResolvedValueOnce(1);
      await featureFlag.resetTenantFlag("t1", "enable_mfa", principal);
      expect(auditService.logAction).toHaveBeenCalledTimes(2);
      expect(auditService.logAction.mock.calls[0][0].changes).toMatchObject({
        operation: "FEATURE_FLAG_RESET",
        before: "true",
        after: null,
      });

      auditService.logAction.mockClear();
      TenantSettings.destroy.mockResolvedValueOnce(0);
      await featureFlag.resetTenantFlag("t1", "enable_mfa", principal);
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    it("initializeTenantFlags from the route audits the defaults it wrote, in the transaction", async () => {
      TenantSettings.bulkCreate.mockResolvedValue([]);
      TenantSettings.findAll.mockResolvedValue([]);
      await featureFlag.initializeTenantFlags("t1", principal);
      expect(TenantSettings.bulkCreate).toHaveBeenCalledWith(expect.any(Array), {
        ignoreDuplicates: true,
        transaction: "txn",
      });
      expect(auditService.logAction.mock.calls[0][0].changes).toMatchObject({
        operation: "FEATURE_FLAG_INITIALIZE",
        flagKeys: expect.arrayContaining(["enable_iot"]),
      });
    });

    it("initializeTenantFlags without a principal (the demo seeder) opens no transaction and writes no row", async () => {
      const { db } = require("../../config");
      TenantSettings.bulkCreate.mockResolvedValue([]);
      TenantSettings.findAll.mockResolvedValue([]);
      await featureFlag.initializeTenantFlags("t1");
      expect(db.transaction).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });
  });
});
