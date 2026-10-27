/**
 * Billing validator tests
 *
 * P9-11 (ADR-093): the schema is Zod, exercised through the shared
 * `checkInput` helper (the file's own `validate` / `formatErrors` are gone).
 */
import { checkInput } from "../../validators/input";
import { updateSubscription } from "../../validators/billing.validator";

const NOTHING_TO_CHANGE = [{ field: "", message: "Provide at least one of planId, status, billingCycle" }];

describe("Billing Validators", () => {
  describe("updateSubscription", () => {
    it("should validate a valid subscription update", () => {
      const result = checkInput({ planId: "plan_pro", status: "Active", billingCycle: "Monthly" }, updateSubscription);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.planId).toBe("plan_pro");
        expect(result.value.billingCycle).toBe("Monthly");
      }
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
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "status", message: 'Invalid option: expected one of "Active"|"PastDue"|"Canceled"|"Unpaid"' },
        ]);
      }
    });

    it("A-225: accepts a reason with a status change, and refuses a body with nothing to change", () => {
      expect(checkInput({ status: "Active", reason: "bank transfer ref 42" }, updateSubscription).ok).toBe(true);
      const noReason = checkInput({ reason: "only a reason" }, updateSubscription);
      expect(noReason.ok).toBe(false);
      if (!noReason.ok) {
        expect(noReason.errors).toEqual(NOTHING_TO_CHANGE);
      }
      const empty = checkInput({}, updateSubscription);
      expect(empty.ok).toBe(false);
      if (!empty.ok) {
        expect(empty.errors).toEqual(NOTHING_TO_CHANGE);
      }
      const absent = checkInput(undefined, updateSubscription);
      expect(absent.ok).toBe(false);
      if (!absent.ok) {
        expect(absent.errors).toEqual(NOTHING_TO_CHANGE);
      }
      const short = checkInput({ status: "Active", reason: "x" }, updateSubscription);
      expect(short.ok).toBe(false);
      if (!short.ok) {
        expect(short.errors).toEqual([
          { field: "reason", message: "Too small: expected string to have >=3 characters" },
        ]);
      }
    });

    it("should reject an invalid billing cycle", () => {
      const result = checkInput({ billingCycle: "Weekly" }, updateSubscription);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "billingCycle", message: 'Invalid option: expected one of "Monthly"|"Annually"' },
        ]);
      }
    });
  });
});
