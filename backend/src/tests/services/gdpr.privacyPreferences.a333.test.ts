/**
 * A-333: the GDPR service offers no "privacy preferences" store.
 *
 * `updatePrivacyPreferences` wrote `privacyPreferences` onto `User`, which has
 * no such attribute and no column. Sequelize dropped the write, and the
 * function still answered `{ success: true }` and wrote a
 * `GDPR_PRIVACY_PREFERENCES` audit row: a record of a change that never
 * happened. `getPrivacyPreferences` therefore always answered `{}`. No route,
 * controller or screen called either function.
 *
 * Decision (A-333): remove the dead pair rather than add a column. A
 * subject's per-purpose choices are already recorded as consent records
 * (`recordConsent` / `withdrawConsent` / `updateConsent`). Those carry the
 * history GDPR Art. 7(1) asks for (every grant and withdrawal, with version
 * and time) and are exported under Article 15. A second, overwrite-in-place
 * JSON store would hold the same choices without that history.
 *
 * This test failed before the change: both functions were exported.
 */
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const gdpr = require("../../services/gdpr.service") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real model, to read its attributes
const models = require("../../models") as { User: { getAttributes(): Record<string, unknown> } };

describe("A-333 — no privacy-preferences store that stores nothing", () => {
  it("the service does not offer updatePrivacyPreferences or getPrivacyPreferences", () => {
    expect(gdpr).not.toHaveProperty("updatePrivacyPreferences");
    expect(gdpr).not.toHaveProperty("getPrivacyPreferences");
  });

  it("the consent functions that do record a subject's choices are still offered", () => {
    for (const name of ["recordConsent", "withdrawConsent", "updateConsent", "getConsentHistory"]) {
      expect(typeof gdpr[name]).toBe("function");
    }
  });

  it("the reason: User has no privacyPreferences attribute", () => {
    expect(Object.keys(models.User.getAttributes())).not.toContain("privacyPreferences");
  });
});
