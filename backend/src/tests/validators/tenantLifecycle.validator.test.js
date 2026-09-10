/**
 * Tenant Lifecycle validator tests
 */
const {
  tenantIdSchema,
  suspendTenantSchema,
  validate,
} = require("../../validators/tenantLifecycle.validator");

describe("Tenant Lifecycle Validators", () => {
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

  describe("suspendTenantSchema", () => {
    it("should validate correct suspend request", () => {
      const value = validate(
        {
          tenantId: "123e4567-e89b-12d3-a456-426614174000",
          reason: "Payment overdue",
        },
        suspendTenantSchema,
      );

      expect(value.tenantId).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(value.reason).toBe("Payment overdue");
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
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000" }, suspendTenantSchema),
      ).toThrow();
    });

    it("should reject empty reason", () => {
      expect(() =>
        validate({ tenantId: "123e4567-e89b-12d3-a456-426614174000", reason: "" }, suspendTenantSchema),
      ).toThrow();
    });
  });
});
