/**
 * Feature Flag validator tests
 */
const {
  flagKeySchema,
  flagValueSchema,
  tenantFlagQuerySchema,
  validate,
} = require("../../validators/featureFlag.validator");

describe("Feature Flag Validators", () => {
  describe("flagKeySchema", () => {
    it("should validate correct flag key data", () => {
      const value = validate(
        { tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "dark_mode" },
        flagKeySchema,
      );

      expect(value.flagKey).toBe("dark_mode");
    });

    it("should reject invalid tenant UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid", flagKey: "dark_mode" }, flagKeySchema),
      ).toThrow();
    });

    it("should reject missing flag key", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000" }, flagKeySchema),
      ).toThrow();
    });

    it("should reject empty flag key", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "" }, flagKeySchema),
      ).toThrow();
    });

    it("should accept flag key with underscores", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "my_feature_flag" }, flagKeySchema),
      ).not.toThrow();
    });

    it("should accept flag key with hyphens", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "my-feature-flag" }, flagKeySchema),
      ).not.toThrow();
    });
  });

  describe("flagValueSchema", () => {
    it("should validate correct flag value data", () => {
      const value = validate(
        { tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "dark_mode", enabled: true },
        flagValueSchema,
      );

      expect(value.enabled).toBe(true);
    });

    it("should validate with enabled false", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "dark_mode", enabled: false }, flagValueSchema),
      ).not.toThrow();
    });

    it("should reject missing enabled field", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "dark_mode" }, flagValueSchema),
      ).toThrow();
    });

    it("should reject non-boolean enabled value", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", flagKey: "dark_mode", enabled: "yes" }, flagValueSchema),
      ).toThrow();
    });

    it("should reject missing flag key", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", enabled: true }, flagValueSchema),
      ).toThrow();
    });
  });

  describe("tenantFlagQuerySchema", () => {
    it("should validate correct tenant query", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000" }, tenantFlagQuerySchema),
      ).not.toThrow();
    });

    it("should reject invalid tenant UUID", () => {
      expect(() =>
        validate({ tenantId: "invalid" }, tenantFlagQuerySchema),
      ).toThrow();
    });

    it("should reject missing tenant ID", () => {
      expect(() =>
        validate({}, tenantFlagQuerySchema),
      ).toThrow();
    });
  });
});
