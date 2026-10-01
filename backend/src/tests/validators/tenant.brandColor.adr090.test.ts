/**
 * ADR-090 amendment: a tenant's brand colour is validated for form only.
 *
 * The contrast guarantee lives where the colour is rendered: the frontend
 * derives an accessible primary per theme (frontend/src/lib/brandColor.ts).
 * These tests pin the decision on the save path so a well-meant "reject
 * low-contrast colours" does not come back: such a rule could only refuse
 * every colour for one of the two themes (no colour reads at 4.5:1 on both
 * #ffffff and #1e293b).
 */
import { validateInput } from "../../validators/input";
import { createTenantSchema, updateTenantSchema } from "../../validators/tenant.validator";

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

// Each fails the ADR-090 rule in at least one theme: yellow and white are
// unreadable as text on white; black and navy are unreadable on the dark card.
const LOW_CONTRAST = ["#ffff00", "#ffffff", "#000000", "#0a1f44", "#7dd3fc"];

describe("tenant brand colour on the save path (ADR-090 amendment)", () => {
  it.each(LOW_CONTRAST)("create accepts %s — contrast is derived, not refused", (colour) => {
    const out = validateInput({ name: "Acme", code: "ACME", primaryColor: colour }, createTenantSchema);
    expect(out.primaryColor).toBe(colour);
  });

  it.each(LOW_CONTRAST)("update accepts %s, stored as the tenant chose it", (colour) => {
    const out = validateInput({ primaryColor: colour }, updateTenantSchema);
    expect(out.primaryColor).toBe(colour);
  });

  it.each(["#fff", "#ffff0000", "ffff00", "yellow", "#gggggg"])(
    "still refuses %s: only #RRGGBB can be derived from",
    (colour) => {
      const err = thrown(() => validateInput({ primaryColor: colour }, updateTenantSchema)) as {
        status?: number;
      };
      expect(err.status).toBe(400);
    },
  );
});
