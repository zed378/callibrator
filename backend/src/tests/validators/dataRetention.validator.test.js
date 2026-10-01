/**
 * Data Retention validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `validateInput` helper. The file's own `validate` threw `errors` as a
 * `{ field: message }` map; `validateInput` throws them as a
 * `[{ field, message }]` list.
 */
const { validateInput: validate } = require("../../validators/input");
const {
  tenantIdSchema,
  retentionPolicySchema,
  legalHoldSchema,
  piiMaskSchema,
  anonymizeSchema,
} = require("../../validators/dataRetention.validator");

const T = "123e4567-e89b-12d3-a456-426614174000";
const R = "123e4567-e89b-12d3-a456-426614174001";
const REQUIRED_STRING = "Invalid input: expected string, received undefined";

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

describe("Data Retention Validators", () => {
  describe("tenantIdSchema", () => {
    it("should validate correct tenant ID", () => {
      const value = validate({ tenantId: T }, tenantIdSchema);

      expect(value.tenantId).toBe(T);
    });

    it("should reject invalid UUID", () => {
      expect(errorsOf({ tenantId: "not-a-uuid" }, tenantIdSchema)).toEqual([
        { field: "tenantId", message: "Invalid GUID" },
      ]);
    });

    it("should reject missing tenant ID", () => {
      expect(errorsOf({}, tenantIdSchema)).toEqual([{ field: "tenantId", message: REQUIRED_STRING }]);
    });
  });

  describe("retentionPolicySchema", () => {
    it("should validate correct retention policy", () => {
      const value = validate({ tenantId: T, policyKey: "data_deletion", days: 30 }, retentionPolicySchema);

      expect(value.days).toBe(30);
    });

    it("converts days from a numeric string", () => {
      expect(validate({ tenantId: T, policyKey: "data_deletion", days: "30" }, retentionPolicySchema).days).toBe(30);
    });

    it("should allow zero days", () => {
      expect(() => validate({ tenantId: T, policyKey: "data_deletion", days: 0 }, retentionPolicySchema)).not.toThrow();
    });

    it("should reject negative days", () => {
      expect(errorsOf({ tenantId: T, policyKey: "data_deletion", days: -1 }, retentionPolicySchema)).toEqual([
        { field: "days", message: "Too small: expected number to be >=0" },
      ]);
    });

    it("should reject non-integer days", () => {
      expect(errorsOf({ tenantId: T, policyKey: "data_deletion", days: 30.5 }, retentionPolicySchema)).toEqual([
        { field: "days", message: "Invalid input: expected int, received number" },
      ]);
    });

    it("should reject missing policy key", () => {
      expect(errorsOf({ tenantId: T, days: 30 }, retentionPolicySchema)).toEqual([
        { field: "policyKey", message: REQUIRED_STRING },
      ]);
    });
  });

  describe("legalHoldSchema", () => {
    it("accepts a tenant with or without a reason", () => {
      expect(validate({ tenantId: T }, legalHoldSchema)).toEqual({ tenantId: T });
      expect(validate({ tenantId: T, reason: "litigation" }, legalHoldSchema)).toEqual({
        tenantId: T,
        reason: "litigation",
      });
    });

    it("refuses an empty reason", () => {
      expect(errorsOf({ tenantId: T, reason: "" }, legalHoldSchema)).toEqual([
        { field: "reason", message: "Too small: expected string to have >=1 characters" },
      ]);
    });
  });

  describe("piiMaskSchema", () => {
    it("should validate correct PII mask request", () => {
      expect(validate({ tenantId: T, entityType: "user", recordIds: [R] }, piiMaskSchema)).toEqual({
        tenantId: T,
        entityType: "user",
        recordIds: [R],
      });
    });

    it("should validate multiple record IDs", () => {
      expect(() =>
        validate(
          { tenantId: T, entityType: "user", recordIds: [R, "123e4567-e89b-12d3-a456-426614174002"] },
          piiMaskSchema,
        ),
      ).not.toThrow();
    });

    it("should reject invalid entity type", () => {
      expect(errorsOf({ tenantId: T, entityType: "", recordIds: [R] }, piiMaskSchema)).toEqual([
        { field: "entityType", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("requires recordIds for any other entity type", () => {
      expect(errorsOf({ tenantId: T, entityType: "users" }, piiMaskSchema)).toEqual([
        { field: "recordIds", message: "recordIds is required when entityType is users" },
      ]);
    });

    describe("A-135 — audit_logs is masked per data subject", () => {
      const S = "123e4567-e89b-12d3-a456-426614174009";

      it("accepts subjectIds for audit_logs", () => {
        expect(validate({ tenantId: T, entityType: "audit_logs", subjectIds: [S] }, piiMaskSchema)).toEqual({
          tenantId: T,
          entityType: "audit_logs",
          subjectIds: [S],
        });
      });

      it("refuses recordIds for audit_logs: audit rows are never named one by one", () => {
        expect(errorsOf({ tenantId: T, entityType: "audit_logs", recordIds: [S] }, piiMaskSchema)).toEqual([
          { field: "subjectIds", message: "subjectIds is required when entityType is audit_logs" },
          { field: "recordIds", message: "recordIds is not allowed when entityType is audit_logs" },
        ]);
      });

      it("requires at least one subject for audit_logs", () => {
        expect(errorsOf({ tenantId: T, entityType: "audit_logs", subjectIds: [] }, piiMaskSchema)).toEqual([
          { field: "subjectIds", message: "Too small: expected array to have >=1 items" },
        ]);
      });

      it("refuses subjectIds for users", () => {
        expect(
          errorsOf({ tenantId: T, entityType: "users", recordIds: [S], subjectIds: [S] }, piiMaskSchema),
        ).toEqual([{ field: "subjectIds", message: "subjectIds is not allowed when entityType is users" }]);
      });
    });

    it("should reject non-UUID in record IDs", () => {
      expect(errorsOf({ tenantId: T, entityType: "user", recordIds: ["not-a-uuid"] }, piiMaskSchema)).toEqual([
        { field: "recordIds.0", message: "Invalid GUID" },
      ]);
    });
  });

  describe("anonymizeSchema", () => {
    it("should validate correct anonymize request", () => {
      expect(() => validate({ tenantId: T, entityType: "user" }, anonymizeSchema)).not.toThrow();
    });

    it("should validate with keepDates option", () => {
      expect(() => validate({ tenantId: T, entityType: "user", options: { keepDates: true } }, anonymizeSchema)).not.toThrow();
    });

    it("should validate with keepNumericIds option", () => {
      expect(() =>
        validate({ tenantId: T, entityType: "user", options: { keepNumericIds: false } }, anonymizeSchema),
      ).not.toThrow();
    });

    it("should validate with both options", () => {
      expect(() =>
        validate({ tenantId: T, entityType: "user", options: { keepDates: true, keepNumericIds: true } }, anonymizeSchema),
      ).not.toThrow();
    });

    it("converts option flags from text", () => {
      expect(validate({ tenantId: T, entityType: "user", options: { keepDates: "true" } }, anonymizeSchema).options).toEqual({
        keepDates: true,
      });
    });

    it("should reject missing entity type", () => {
      expect(errorsOf({ tenantId: T }, anonymizeSchema)).toEqual([{ field: "entityType", message: REQUIRED_STRING }]);
    });
  });
});
