// Mock TenantSettings model
jest.mock("../src/models", () => ({
  TenantSettings: {
    findOne: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue([{ value: "true" }, true]),
    destroy: jest.fn().mockResolvedValue(1),
    bulkCreate: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock the sequelize import at module level
jest.mock("sequelize", () => {
  const actual = jest.requireActual("sequelize");
  return {
    ...actual,
    Op: { ...actual.Op, like: "$like$" },
  };
});

const {
  DEFAULT_FLAGS,
  FEATURE_FLAG_CATEGORIES,
} = require("../src/services/featureFlag.service");

const {
  isEnabled,
  getTenantFlags,
  setTenantFlag,
  resetTenantFlag,
  initializeTenantFlags,
} = require("../src/services/featureFlag.service");

describe("featureFlag.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("DEFAULT_FLAGS", () => {
    it("should have expected feature flags defined", () => {
      expect(DEFAULT_FLAGS).toBeDefined();
      expect(DEFAULT_FLAGS).toHaveProperty("enable_iot");
      expect(DEFAULT_FLAGS).toHaveProperty("enable_ai_ocr");
      expect(DEFAULT_FLAGS).toHaveProperty("enable_mfa");
      expect(DEFAULT_FLAGS).toHaveProperty("enable_scheduler");
    });

    it("should have category and defaultValue for each flag", () => {
      for (const [key, flag] of Object.entries(DEFAULT_FLAGS)) {
        expect(flag).toHaveProperty("category");
        expect(flag).toHaveProperty("defaultValue");
        expect(flag).toHaveProperty("description");
      }
    });

    it("should have 14 default flags", () => {
      expect(Object.keys(DEFAULT_FLAGS).length).toBe(14);
    });
  });

  describe("FEATURE_FLAG_CATEGORIES", () => {
    it("should have expected categories", () => {
      expect(FEATURE_FLAG_CATEGORIES).toBeDefined();
      expect(FEATURE_FLAG_CATEGORIES).toHaveProperty("PLATFORM");
      expect(FEATURE_FLAG_CATEGORIES).toHaveProperty("CALIBRATION");
      expect(FEATURE_FLAG_CATEGORIES).toHaveProperty("BILLING");
      expect(FEATURE_FLAG_CATEGORIES).toHaveProperty("COMPLIANCE");
      expect(FEATURE_FLAG_CATEGORIES).toHaveProperty("AI");
    });

    it("should have 7 categories", () => {
      expect(Object.keys(FEATURE_FLAG_CATEGORIES).length).toBe(7);
    });
  });

  describe("isEnabled", () => {
    it("should return false for unknown flag", async () => {
      const result = await isEnabled("tenant-1", "unknown_flag");
      expect(result).toBe(false);
    });

    it("should return default value when no tenant override exists", async () => {
      const result = await isEnabled("tenant-1", "enable_iot");
      expect(result).toBe(true); // enable_iot defaultValue is true
    });

    it("should return false when default is false and no override", async () => {
      const result = await isEnabled("tenant-1", "enable_mfa");
      expect(result).toBe(false); // enable_mfa defaultValue is false
    });

    it("should return true when tenant override is true", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.findOne.mockResolvedValue({ value: "true" });

      const result = await isEnabled("tenant-1", "enable_iot");
      expect(result).toBe(true);
    });

    it("should return false when tenant override is false", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.findOne.mockResolvedValue({ value: "false" });

      const result = await isEnabled("tenant-1", "enable_iot");
      expect(result).toBe(false);
    });

    it("should return true when tenant override is boolean true", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.findOne.mockResolvedValue({ value: true });

      const result = await isEnabled("tenant-1", "enable_iot");
      expect(result).toBe(true);
    });
  });

  describe("getTenantFlags", () => {
    it("should return all flags with defaults when no overrides", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.findAll.mockResolvedValue([]);

      const result = await getTenantFlags("tenant-1");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("enable_iot");
      expect(result.enable_iot).toHaveProperty("enabled", true);
      expect(result.enable_iot).toHaveProperty("defaultValue", true);
      expect(result.enable_iot).toHaveProperty("tenantOverride", false);
    });

    it("should return flags with tenant overrides when they exist", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.findAll.mockResolvedValue([
        { key: "feature_flag_enable_mfa", value: "true" },
      ]);

      const result = await getTenantFlags("tenant-1");

      expect(result.enable_mfa).toHaveProperty("enabled", true);
      expect(result.enable_mfa).toHaveProperty("tenantOverride", true);
      // enable_iot should still use default
      expect(result.enable_iot).toHaveProperty("tenantOverride", false);
    });

    it("should include category and description for each flag", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.findAll.mockResolvedValue([]);

      const result = await getTenantFlags("tenant-1");

      expect(result.enable_iot).toHaveProperty("category");
      expect(result.enable_iot).toHaveProperty("description");
    });
  });

  describe("setTenantFlag", () => {
    it("should throw error for unknown flag", async () => {
      await expect(
        setTenantFlag("tenant-1", "unknown_flag", true),
      ).rejects.toThrow("Unknown feature flag: unknown_flag");
    });

    it("should upsert the flag setting when set to true", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.upsert.mockResolvedValue([{ value: "true" }, true]);

      const result = await setTenantFlag(
        "tenant-1",
        "enable_mfa",
        true,
        "admin-1",
      );

      expect(TenantSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          key: "feature_flag_enable_mfa",
          value: "true",
          updatedBy: "admin-1",
        }),
      );
      expect(result.flagKey).toBe("enable_mfa");
      expect(result.enabled).toBe(true);
    });

    it("should upsert the flag setting when set to false", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.upsert.mockResolvedValue([{ value: "false" }, false]);

      const result = await setTenantFlag(
        "tenant-1",
        "enable_iot",
        false,
        "admin-1",
      );

      expect(TenantSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          key: "feature_flag_enable_iot",
          value: "false",
          updatedBy: "admin-1",
        }),
      );
      expect(result.flagKey).toBe("enable_iot");
      expect(result.enabled).toBe(false);
    });
  });

  describe("resetTenantFlag", () => {
    it("should destroy the tenant setting", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.destroy.mockResolvedValue(1);

      const result = await resetTenantFlag("tenant-1", "enable_mfa");

      expect(TenantSettings.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            key: "feature_flag_enable_mfa",
          }),
        }),
      );
      expect(result.flagKey).toBe("enable_mfa");
      expect(result.reset).toBe(true);
      expect(result.defaultValue).toBe(false);
    });

    it("should return reset: false when no setting was found", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.destroy.mockResolvedValue(0);

      const result = await resetTenantFlag("tenant-1", "enable_mfa");

      expect(result.reset).toBe(false);
    });

    it("should return false defaultValue for unknown flag", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.destroy.mockResolvedValue(0);

      const result = await resetTenantFlag("tenant-1", "unknown_flag");

      expect(result.reset).toBe(false);
      expect(result.defaultValue).toBe(false);
    });
  });

  describe("initializeTenantFlags", () => {
    it("should create settings for flags with defaultValue true", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.bulkCreate.mockResolvedValue(undefined);
      TenantSettings.findAll.mockResolvedValue([]);

      const result = await initializeTenantFlags("tenant-1");

      expect(TenantSettings.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tenantId: "tenant-1",
            key: "feature_flag_enable_iot",
            value: "true",
          }),
        ]),
        { ignoreDuplicates: true },
      );
    });

    it("should not create settings for flags with defaultValue false", async () => {
      const { TenantSettings } = require("../src/models");
      TenantSettings.bulkCreate.mockResolvedValue(undefined);
      TenantSettings.findAll.mockResolvedValue([]);

      await initializeTenantFlags("tenant-1");

      // enable_mfa has defaultValue false, so it should not be created
      const callArgs = TenantSettings.bulkCreate.mock.calls[0][0];
      const mfaSetting = callArgs.find(
        (s) => s.key === "feature_flag_enable_mfa",
      );
      expect(mfaSetting).toBeUndefined();
    });
  });
});
