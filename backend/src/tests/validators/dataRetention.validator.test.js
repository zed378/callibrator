/**
 * Data Retention validator tests
 */
const {
  tenantIdSchema,
  retentionPolicySchema,
  piiMaskSchema,
  anonymizeSchema,
  validate,
} = require("../../validators/dataRetention.validator");

describe("Data Retention Validators", () => {
  describe("tenantIdSchema", () => {
    it("should validate correct tenant ID", () => {
      const value = validate(
        { tenantId: "123e4567-e89b-12d3-a456-426614174000" },
        tenantIdSchema,
      );

      expect(value.tenantId).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("should reject invalid UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid" }, tenantIdSchema),
      ).toThrow();
    });

    it("should reject missing tenant ID", () => {
      expect(() =>
        validate({}, tenantIdSchema),
      ).toThrow();
    });
  });

  describe("retentionPolicySchema", () => {
    it("should validate correct retention policy", () => {
      const value = validate(
        {
          tenantId: "123e4567-e89b-12d3-a456-426614174000",
          policyKey: "data_deletion",
          days: 30,
        },
        retentionPolicySchema,
      );

      expect(value.days).toBe(30);
    });

    it("should allow zero days", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            policyKey: "data_deletion",
            days: 0,
          },
          retentionPolicySchema,
        ),
      ).not.toThrow();
    });

    it("should reject negative days", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            policyKey: "data_deletion",
            days: -1,
          },
          retentionPolicySchema,
        ),
      ).toThrow();
    });

    it("should reject non-integer days", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            policyKey: "data_deletion",
            days: 30.5,
          },
          retentionPolicySchema,
        ),
      ).toThrow();
    });

    it("should reject missing policy key", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            days: 30,
          },
          retentionPolicySchema,
        ),
      ).toThrow();
    });
  });

  describe("piiMaskSchema", () => {
    it("should validate correct PII mask request", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
            recordIds: ["123e4567-e89b-12d3-a456-426614174001"],
          },
          piiMaskSchema,
        ),
      ).not.toThrow();
    });

    it("should validate multiple record IDs", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
            recordIds: [
              "123e4567-e89b-12d3-a456-426614174001",
              "123e4567-e89b-12d3-a456-426614174002",
            ],
          },
          piiMaskSchema,
        ),
      ).not.toThrow();
    });

    it("should reject invalid entity type", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "",
            recordIds: ["123e4567-e89b-12d3-a456-426614174001"],
          },
          piiMaskSchema,
        ),
      ).toThrow();
    });

    it("should reject non-UUID in record IDs", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
            recordIds: ["not-a-uuid"],
          },
          piiMaskSchema,
        ),
      ).toThrow();
    });
  });

  describe("anonymizeSchema", () => {
    it("should validate correct anonymize request", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
          },
          anonymizeSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with keepDates option", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
            options: { keepDates: true },
          },
          anonymizeSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with keepNumericIds option", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
            options: { keepNumericIds: false },
          },
          anonymizeSchema,
        ),
      ).not.toThrow();
    });

    it("should validate with both options", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
            entityType: "user",
            options: { keepDates: true, keepNumericIds: true },
          },
          anonymizeSchema,
        ),
      ).not.toThrow();
    });

    it("should reject missing entity type", () => {
      expect(() =>
        validate(
          {
            tenantId: "123e4567-e89b-12d3-a456-426614174000",
          },
          anonymizeSchema,
        ),
      ).toThrow();
    });
  });
});