/**
 * Billing validator tests
 */
const {
  updateSubscription,
  validate,
  formatErrors,
} = require("../../validators/billing.validator");

describe("Billing Validators", () => {
  describe("updateSubscription", () => {
    it("should validate a valid subscription update", () => {
      const { error, value } = validate(
        { planId: "plan_pro", status: "Active", billingCycle: "Monthly" },
        updateSubscription,
      );
      expect(error).toBeUndefined();
      expect(value.planId).toBe("plan_pro");
      expect(value.billingCycle).toBe("Monthly");
    });

    it("should allow a partial update", () => {
      const { error } = validate({ status: "PastDue" }, updateSubscription);
      expect(error).toBeUndefined();
    });

    it("should reject an invalid status", () => {
      const { error } = validate({ status: "Yearly" }, updateSubscription);
      expect(error).toBeDefined();
    });

    it("should reject an invalid billing cycle", () => {
      const { error } = validate(
        { billingCycle: "Weekly" },
        updateSubscription,
      );
      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format validation error details", () => {
      const { error } = validate({ status: "Invalid" }, updateSubscription);
      const formatted = formatErrors(error.details);
      expect(Array.isArray(formatted)).toBe(true);
      expect(formatted[0]).toHaveProperty("field");
      expect(formatted[0]).toHaveProperty("message");
    });

    it("should handle nested field paths", () => {
      const formatted = formatErrors([
        {
          path: ["billingCycle"],
          message: '"billingCycle" must be one of [Monthly, Annually]',
        },
      ]);
      expect(formatted[0].field).toBe("billingCycle");
    });

    it("should return empty array for empty input", () => {
      const formatted = formatErrors([]);
      expect(formatted).toEqual([]);
    });
  });
});
