/**
 * Tenant Lifecycle validator tests
 *
 * P9-11: the file's own validate() — which threw `errors` as a key-map — is
 * gone; the shared validateInput throws `errors` as a `{ field, message }` list.
 */
const {
  tenantIdSchema,
  suspendTenantSchema,
} = require("../../validators/tenantLifecycle.validator");
const { validateInput: validate } = require("../../validators/input");

const ID = "123e4567-e89b-12d3-a456-426614174000";

/** @returns {unknown} what `fn` threw */
const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

describe("Tenant Lifecycle Validators", () => {
  describe("tenantIdSchema", () => {
    it("should validate correct tenant ID", () => {
      const value = validate({ tenantId: ID }, tenantIdSchema);

      expect(value).toEqual({ tenantId: ID });
    });

    it("should reject invalid UUID", () => {
      expect(thrown(() => validate({ tenantId: "not-a-uuid" }, tenantIdSchema))).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "tenantId", message: "Invalid GUID" }],
      });
    });

    it("should reject missing tenant ID", () => {
      expect(() => validate({}, tenantIdSchema)).toThrow();
      expect(() => validate(undefined, tenantIdSchema)).toThrow();
    });
  });

  describe("suspendTenantSchema", () => {
    it("should validate correct suspend request", () => {
      const value = validate({ tenantId: ID, reason: "Payment overdue" }, suspendTenantSchema);

      expect(value.tenantId).toBe(ID);
      expect(value.reason).toBe("Payment overdue");
    });

    it("should strip unknown fields", () => {
      expect(validate({ tenantId: ID, reason: "x", status: "ACTIVE" }, suspendTenantSchema)).toEqual({
        tenantId: ID,
        reason: "x",
      });
    });

    it("should reject invalid tenant UUID", () => {
      expect(() =>
        validate({ tenantId: "not-a-uuid", reason: "Test" }, suspendTenantSchema),
      ).toThrow();
    });

    it("should reject missing tenant ID", () => {
      expect(() =>
        validate({ reason: "Test" }, suspendTenantSchema),
      ).toThrow();
    });

    it("should reject missing reason", () => {
      expect(thrown(() => validate({ tenantId: ID }, suspendTenantSchema)).errors).toEqual([
        { field: "reason", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject empty reason", () => {
      expect(thrown(() => validate({ tenantId: ID, reason: "" }, suspendTenantSchema)).errors).toEqual([
        { field: "reason", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should report both fields when both are wrong", () => {
      expect(thrown(() => validate({}, suspendTenantSchema)).errors.map((e) => e.field)).toEqual([
        "tenantId",
        "reason",
      ]);
    });
  });
});
