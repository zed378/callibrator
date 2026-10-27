/**
 * Tenant Lifecycle validator tests
 *
 * P9-11: the file's own validate() — which threw `errors` as a key-map — is
 * gone; the shared validateInput throws `errors` as a `{ field, message }` list.
 */
import { tenantIdSchema, suspendTenantSchema } from "../../validators/tenantLifecycle.validator";
import { validateInput, type ValidationFailure } from "../../validators/input";

const ID = "123e4567-e89b-12d3-a456-426614174000";

const thrown = (fn: () => unknown): unknown => {
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
      const value = validateInput({ tenantId: ID }, tenantIdSchema);

      expect(value).toEqual({ tenantId: ID });
    });

    it("should reject invalid UUID", () => {
      expect(thrown(() => validateInput({ tenantId: "not-a-uuid" }, tenantIdSchema))).toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "tenantId", message: "Invalid GUID" }],
      });
    });

    it("should reject missing tenant ID", () => {
      expect(() => validateInput({}, tenantIdSchema)).toThrow();
      expect(() => validateInput(undefined, tenantIdSchema)).toThrow();
    });
  });

  describe("suspendTenantSchema", () => {
    it("should validate correct suspend request", () => {
      const value = validateInput({ tenantId: ID, reason: "Payment overdue" }, suspendTenantSchema);

      expect(value.tenantId).toBe(ID);
      expect(value.reason).toBe("Payment overdue");
    });

    it("should strip unknown fields", () => {
      expect(validateInput({ tenantId: ID, reason: "x", status: "ACTIVE" }, suspendTenantSchema)).toEqual({
        tenantId: ID,
        reason: "x",
      });
    });

    it("should reject invalid tenant UUID", () => {
      expect(() => validateInput({ tenantId: "not-a-uuid", reason: "Test" }, suspendTenantSchema)).toThrow();
    });

    it("should reject missing tenant ID", () => {
      expect(() => validateInput({ reason: "Test" }, suspendTenantSchema)).toThrow();
    });

    it("should reject missing reason", () => {
      const err = thrown(() => validateInput({ tenantId: ID }, suspendTenantSchema)) as ValidationFailure;
      expect(err.errors).toEqual([
        { field: "reason", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject empty reason", () => {
      const err = thrown(() => validateInput({ tenantId: ID, reason: "" }, suspendTenantSchema)) as ValidationFailure;
      expect(err.errors).toEqual([
        { field: "reason", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should report both fields when both are wrong", () => {
      const err = thrown(() => validateInput({}, suspendTenantSchema)) as ValidationFailure;
      expect(err.errors.map((e) => e.field)).toEqual(["tenantId", "reason"]);
    });
  });
});
