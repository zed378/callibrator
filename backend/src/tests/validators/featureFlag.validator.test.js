/**
 * Feature Flag validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `validateInput` helper. The file's own `validate` threw `errors` as a
 * `{ field: message }` map; `validateInput` throws them as a
 * `[{ field, message }]` list.
 */
const { validateInput: validate } = require("../../validators/input");
const {
  flagKeySchema,
  flagValueSchema,
  tenantFlagQuerySchema,
} = require("../../validators/featureFlag.validator");

const T = "123e4567-e89b-12d3-a456-426614174000";

/** @returns the field errors `validate` threw (asserting the 400 shape), or undefined */
const errorsOf = (data, schema) => {
  try {
    validate(data, schema);
  } catch (error) {
    expect(error).toMatchObject({ status: 400, message: "Validation failed" });
    return error.errors;
  }
  return undefined;
};

describe("Feature Flag Validators", () => {
  describe("flagKeySchema", () => {
    it("should validate correct flag key data", () => {
      const value = validate({ tenantId: T, flagKey: "dark_mode" }, flagKeySchema);

      expect(value.flagKey).toBe("dark_mode");
    });

    it("should reject invalid tenant UUID", () => {
      expect(errorsOf({ tenantId: "not-a-uuid", flagKey: "dark_mode" }, flagKeySchema)).toEqual([
        { field: "tenantId", message: "Invalid GUID" },
      ]);
    });

    it("should reject missing flag key", () => {
      expect(errorsOf({ tenantId: T }, flagKeySchema)).toEqual([
        { field: "flagKey", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject empty flag key", () => {
      expect(errorsOf({ tenantId: T, flagKey: "" }, flagKeySchema)).toEqual([
        { field: "flagKey", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should accept flag key with underscores", () => {
      expect(() => validate({ tenantId: T, flagKey: "my_feature_flag" }, flagKeySchema)).not.toThrow();
    });

    it("should accept flag key with hyphens", () => {
      expect(() => validate({ tenantId: T, flagKey: "my-feature-flag" }, flagKeySchema)).not.toThrow();
    });
  });

  describe("flagValueSchema", () => {
    it("should validate correct flag value data", () => {
      const value = validate({ tenantId: T, flagKey: "dark_mode", enabled: true }, flagValueSchema);

      expect(value.enabled).toBe(true);
    });

    it("should validate with enabled false", () => {
      expect(() => validate({ tenantId: T, flagKey: "dark_mode", enabled: false }, flagValueSchema)).not.toThrow();
    });

    it("converts enabled from \"true\" / \"false\"", () => {
      expect(validate({ tenantId: T, flagKey: "dark_mode", enabled: "false" }, flagValueSchema).enabled).toBe(false);
      expect(validate({ tenantId: T, flagKey: "dark_mode", enabled: "true" }, flagValueSchema).enabled).toBe(true);
    });

    it("should reject missing enabled field", () => {
      expect(errorsOf({ tenantId: T, flagKey: "dark_mode" }, flagValueSchema)).toEqual([
        { field: "enabled", message: "Invalid input: expected boolean, received undefined" },
      ]);
    });

    it("should reject non-boolean enabled value", () => {
      expect(errorsOf({ tenantId: T, flagKey: "dark_mode", enabled: "yes" }, flagValueSchema)).toEqual([
        { field: "enabled", message: "Invalid input: expected boolean, received string" },
      ]);
    });

    it("should reject missing flag key", () => {
      expect(errorsOf({ tenantId: T, enabled: true }, flagValueSchema)).toEqual([
        { field: "flagKey", message: "Invalid input: expected string, received undefined" },
      ]);
    });
  });

  describe("tenantFlagQuerySchema", () => {
    it("should validate correct tenant query", () => {
      expect(validate({ tenantId: T }, tenantFlagQuerySchema)).toEqual({ tenantId: T });
    });

    it("should reject invalid tenant UUID", () => {
      expect(errorsOf({ tenantId: "invalid" }, tenantFlagQuerySchema)).toEqual([
        { field: "tenantId", message: "Invalid GUID" },
      ]);
    });

    it("should reject missing tenant ID", () => {
      expect(errorsOf({}, tenantFlagQuerySchema)).toEqual([
        { field: "tenantId", message: "Invalid input: expected string, received undefined" },
      ]);
    });
  });
});
