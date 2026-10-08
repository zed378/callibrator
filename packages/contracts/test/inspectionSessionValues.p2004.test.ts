/**
 * P20-04 (ADR-126 Am. 1, Am. 2; P19-02 spec § 4, § 9.1; P19-06 spec § 4) — the IPM session's
 * vocabularies. The backend's ENUM columns are held equal to these by stateUnions.p905 and
 * enumMirrors.d26; here the values themselves are pinned, in their order (the order `sync` and
 * migration 0126 create each type in).
 */
import {
  INSPECTION_OUTCOME_SOURCES,
  INSPECTION_OVERALL_OUTCOMES,
  INSPECTION_RECOMMENDATIONS,
  INSPECTION_SIGNATURE_AUTH_METHODS,
  INSPECTION_SIGNATURE_KINDS,
  INSPECTION_SIGNATURE_MEANINGS,
} from "@callibrator/contracts/inspectionValues";
import { IDEMPOTENCY_KEY_STATUSES, INSPECTION_SESSION_STATUSES } from "@callibrator/contracts/states";

describe("P20-04 — IPM session vocabularies", () => {
  it("a session: draft, submitted, voided, discarded (superseded is submitted with superseded_by_id)", () => {
    expect(INSPECTION_SESSION_STATUSES).toEqual(["draft", "submitted", "voided", "discarded"]);
  });

  it("the overall outcomes and the recommendation of F-47, F-50, F-51 (upstream 1 / 0 / −1 / −2)", () => {
    expect(INSPECTION_OVERALL_OUTCOMES).toEqual(["pass", "fail"]);
    expect(INSPECTION_RECOMMENDATIONS).toEqual(["fit_for_use", "needs_calibration", "not_fit_for_use", "needs_repair"]);
    expect(INSPECTION_OUTCOME_SOURCES).toEqual(["technician", "computed"]);
  });

  it("the signatures of P19-06 § 4.2: two kinds, their meanings, the re-entered credential", () => {
    expect(INSPECTION_SIGNATURE_KINDS).toEqual(["performer", "countersign"]);
    expect(INSPECTION_SIGNATURE_MEANINGS).toEqual(["authorship", "review"]);
    expect(INSPECTION_SIGNATURE_AUTH_METHODS).toEqual(["password", "mfa"]);
  });

  it("an idempotency key is in_flight, then completed", () => {
    expect(IDEMPOTENCY_KEY_STATUSES).toEqual(["in_flight", "completed"]);
  });

  it("every tuple is frozen", () => {
    for (const tuple of [
      INSPECTION_SESSION_STATUSES,
      INSPECTION_OVERALL_OUTCOMES,
      INSPECTION_RECOMMENDATIONS,
      INSPECTION_OUTCOME_SOURCES,
      INSPECTION_SIGNATURE_KINDS,
      INSPECTION_SIGNATURE_MEANINGS,
      INSPECTION_SIGNATURE_AUTH_METHODS,
      IDEMPOTENCY_KEY_STATUSES,
    ]) {
      expect(Object.isFrozen(tuple)).toBe(true);
    }
  });
});
