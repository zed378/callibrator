/**
 * P22-04 — the IPM history's plain rules: the list query (only what is set; days as the local day's
 * bounds), a session's state, who is OFFERED a correction or a void (the server still decides), the
 * reason's bounds, the recorded device / facility / room, the visit label, a measured value, the
 * notices, `?deviceId=` and the `datetime-local` value.
 */
import {
  INITIAL_FILTERS,
  canCorrect,
  canVoid,
  dayEnd,
  dayStart,
  deviceIdOf,
  deviceOf,
  facilityOf,
  isDraft,
  listQuery,
  localInput,
  measuredText,
  noticesOf,
  reasonValid,
  roomOf,
  stateOf,
  visitLabel,
} from "../history";

const ID = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const effective = { status: "submitted" as const, effective: true, supersededById: null };
const writer = { write: true, bound: false, superAdmin: false };

describe("P22-04 — the history's rules", () => {
  it("listQuery: page and sort always; each filter only when set; the device; days as local bounds", () => {
    expect(listQuery(INITIAL_FILTERS, 1, null)).toEqual({ page: 1, limit: 20, sort: "performedAt" });
    expect(
      listQuery(
        { q: "  pump ", status: "voided", effectiveOnly: true, recommendation: "needs_repair", from: "2026-10-01", to: "2026-10-31", clientFacilityId: "f1" },
        3,
        ID,
      ),
    ).toEqual({
      page: 3,
      limit: 20,
      sort: "performedAt",
      deviceId: ID,
      q: "pump",
      status: "voided",
      effective: true,
      recommendation: "needs_repair",
      from: dayStart("2026-10-01"),
      to: dayEnd("2026-10-31"),
      clientFacilityId: "f1",
    });
    expect(listQuery({ ...INITIAL_FILTERS, from: "2026-10", to: "x" }, 1, null)).toEqual({ page: 1, limit: 20, sort: "performedAt" });
    expect(new Date(dayEnd("2026-10-31")).getTime() - new Date(dayStart("2026-10-31")).getTime()).toBe(24 * 3600 * 1000 - 1);
  });

  it("stateOf: effective, superseded, and the other statuses as they are", () => {
    expect(stateOf(effective)).toBe("effective");
    expect(stateOf({ ...effective, effective: false })).toBe("superseded");
    expect(stateOf({ ...effective, supersededById: ID })).toBe("superseded");
    expect(stateOf({ status: "voided", effective: false, supersededById: null })).toBe("voided");
    expect(stateOf({ status: "draft", effective: false, supersededById: null })).toBe("draft");
    expect(isDraft({ status: "draft" })).toBe(true);
    expect(isDraft({ status: "submitted" })).toBe(false);
  });

  it("correct: an effective visit, an ipm writer, never the platform operator; void: the same and unbound", () => {
    expect(canCorrect(effective, writer)).toBe(true);
    expect(canVoid(effective, writer)).toBe(true);
    expect(canCorrect(effective, { ...writer, bound: true })).toBe(true);
    expect(canVoid(effective, { ...writer, bound: true })).toBe(false);
    expect(canCorrect(effective, { ...writer, superAdmin: true })).toBe(false);
    expect(canCorrect(effective, { ...writer, write: false })).toBe(false);
    expect(canCorrect({ ...effective, supersededById: ID }, writer)).toBe(false);
    expect(canVoid({ status: "voided", effective: false, supersededById: null }, writer)).toBe(false);
  });

  it("a reason is 3 – 2000 characters once trimmed", () => {
    expect(reasonValid("  ab ")).toBe(false);
    expect(reasonValid("abc")).toBe(true);
    expect(reasonValid("x".repeat(2000))).toBe(true);
    expect(reasonValid("x".repeat(2001))).toBe(false);
  });

  it("the recorded device, facility and room; nothing for a draft", () => {
    expect(deviceOf({ deviceSnapshot: { name: "Pump", qrCode: "QR-1", serialNumber: "" } })).toEqual({ name: "Pump", qrCode: "QR-1", serialNumber: null });
    expect(deviceOf({ deviceSnapshot: null })).toBeNull();
    expect(deviceOf({ deviceSnapshot: { name: " " } })).toBeNull();
    expect(facilityOf({ facilitySnapshot: { name: "Clinic" } })).toBe("Clinic");
    expect(facilityOf({ facilitySnapshot: null })).toBeNull();
    expect(roomOf({ roomSnapshot: "ICU", floorSnapshot: "2" })).toBe("ICU · 2");
    expect(roomOf({ roomSnapshot: null, floorSnapshot: "" })).toBeNull();
  });

  it("the visit as three digits; a measured value with its unit; notices de-duplicated", () => {
    expect(visitLabel(7)).toBe("007");
    expect(visitLabel(null)).toBeNull();
    expect(measuredText({ measuredValue: "0.5", measuredValue1: null, measuredValue2: "", unit: "mA" })).toBe("0.5 mA");
    expect(measuredText({ measuredValue: "1", measuredValue1: "2", measuredValue2: null, unit: null })).toBe("1 / 2");
    expect(measuredText({ measuredValue: null, measuredValue1: null, measuredValue2: null, unit: "V" })).toBeNull();
    expect(noticesOf({ notices: ["a"], sideEffects: { notices: ["a", "b", 3] } })).toEqual(["a", "b"]);
    expect(noticesOf({ notices: null, sideEffects: null })).toEqual([]);
    expect(noticesOf({ sideEffects: { notices: "x" } })).toEqual([]);
  });

  it("?deviceId= only when it is one uuid; the datetime-local value of an instant", () => {
    expect(deviceIdOf(ID)).toBe(ID);
    expect(deviceIdOf("nope")).toBeNull();
    expect(deviceIdOf([ID])).toBeNull();
    expect(deviceIdOf(undefined)).toBeNull();
    const local = new Date(2026, 9, 3, 9, 5);
    expect(localInput(local.toISOString())).toBe("2026-10-03T09:05");
    expect(localInput("not a date")).toBe("");
  });
});
