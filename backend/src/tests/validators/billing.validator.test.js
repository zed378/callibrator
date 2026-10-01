/**
 * Billing validator tests
 *
 * P9-11 (ADR-093): the schema is Zod, exercised through the shared
 * `checkInput` helper (the file's own `validate` / `formatErrors` are gone).
 */
const { checkInput } = require("../../validators/input");
const { updateSubscription } = require("../../validators/billing.validator");

const NOTHING_TO_CHANGE = [{ field: "", message: "Provide at least one of planId, status, billingCycle" }];

describe("Billing Validators", () => {
  describe("updateSubscription", () => {
    it("should validate a valid subscription update", () => {
      const result = checkInput({ planId: "plan_pro", status: "Active", billingCycle: "Monthly" }, updateSubscription);
      expect(result.ok).toBe(true);
      expect(result.value.planId).toBe("plan_pro");
      expect(result.value.billingCycle).toBe("Monthly");
    });

    it("trims planId and strips unknown keys", () => {
      expect(checkInput({ planId: "  plan_pro  ", tenantId: "x" }, updateSubscription)).toEqual({
        ok: true,
        value: { planId: "plan_pro" },
      });
    });

    it("should allow a partial update", () => {
      expect(checkInput({ status: "PastDue" }, updateSubscription).ok).toBe(true);
    });

    it("should reject an invalid status", () => {
      const result = checkInput({ status: "Yearly" }, updateSubscription);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "Active"|"PastDue"|"Canceled"|"Unpaid"' },
      ]);
    });

    it("A-225: accepts a reason with a status change, and refuses a body with nothing to change", () => {
      expect(checkInput({ status: "Active", reason: "bank transfer ref 42" }, updateSubscription).ok).toBe(true);
      expect(checkInput({ reason: "only a reason" }, updateSubscription).errors).toEqual(NOTHING_TO_CHANGE);
      expect(checkInput({}, updateSubscription).errors).toEqual(NOTHING_TO_CHANGE);
      expect(checkInput(undefined, updateSubscription).errors).toEqual(NOTHING_TO_CHANGE);
      expect(checkInput({ status: "Active", reason: "x" }, updateSubscription).errors).toEqual([
        { field: "reason", message: "Too small: expected string to have >=3 characters" },
      ]);
    });

    it("should reject an invalid billing cycle", () => {
      const result = checkInput({ billingCycle: "Weekly" }, updateSubscription);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "billingCycle", message: 'Invalid option: expected one of "Monthly"|"Annually"' },
      ]);
    });
  });
});
