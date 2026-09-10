jest.mock("../../models", () => ({
  TenantSettings: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    upsert: jest.fn(() => Promise.resolve([{}, true])),
    bulkCreate: jest.fn(),
    destroy: jest.fn(),
  },
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
      });
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
      });
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
});
