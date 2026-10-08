/**
 * P20-07 (ADR-124 Am. 2; P19-04 spec § 4.1, § 5.5, § 13.2) — the client-facility vocabularies.
 * The backend's ENUM columns are held equal to these by stateUnions.p905 and enumMirrors.d26;
 * here the values themselves are pinned, in their order (the order `sync` creates the type in).
 */
import {
  CLIENT_FACILITY_KINDS,
  CLIENT_FACILITY_MOVE_STATUSES,
  CLIENT_FACILITY_STATUSES,
} from "@callibrator/contracts/states";

describe("P20-07 — client-facility vocabularies", () => {
  it("the kinds of ADR-124 § 2, in order", () => {
    expect(CLIENT_FACILITY_KINDS).toEqual(["hospital", "clinic", "health_centre", "district_office", "laboratory", "other"]);
  });

  it("the lifecycle: active, inactive, ended (no deleted — a leaving client is ended)", () => {
    expect(CLIENT_FACILITY_STATUSES).toEqual(["active", "inactive", "ended"]);
  });

  it("a move is in_progress inside its transaction and completed before commit", () => {
    expect(CLIENT_FACILITY_MOVE_STATUSES).toEqual(["in_progress", "completed"]);
  });

  it("every tuple is frozen", () => {
    for (const tuple of [CLIENT_FACILITY_KINDS, CLIENT_FACILITY_STATUSES, CLIENT_FACILITY_MOVE_STATUSES]) {
      expect(Object.isFrozen(tuple)).toBe(true);
    }
  });
});
