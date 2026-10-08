/**
 * P21-09e — the person display contract (spec P19-04 § 12): exactly four keys, strict.
 */
import { PERSON_DISPLAY_KEYS, PLATFORM_SUPPORT_NAME, personDisplay } from "@callibrator/contracts/people";

describe("P21-09e — personDisplay", () => {
  it("accepts a shown and a redacted person; its keys are exactly PERSON_DISPLAY_KEYS", () => {
    const shown = { name: "Ana Calibrator", role: "TECHNICIAN", organisation: "Lab", redacted: false };
    expect(personDisplay.parse(shown)).toEqual(shown);
    expect(personDisplay.parse({ name: null, role: "ROOM USER", organisation: null, redacted: true }).redacted).toBe(true);
    expect(Object.keys(personDisplay.shape)).toEqual([...PERSON_DISPLAY_KEYS]);
    expect(PLATFORM_SUPPORT_NAME).toBe("Platform support");
  });

  it("refuses an identifier, an e-mail or a missing key (FT-15)", () => {
    expect(personDisplay.safeParse({ name: "A", role: null, organisation: null, redacted: false, id: "x" }).success).toBe(false);
    expect(personDisplay.safeParse({ name: "A", role: null, organisation: null, redacted: false, email: "a@example.test" }).success).toBe(false);
    expect(personDisplay.safeParse({ name: "A", role: null, organisation: null }).success).toBe(false);
  });
});
