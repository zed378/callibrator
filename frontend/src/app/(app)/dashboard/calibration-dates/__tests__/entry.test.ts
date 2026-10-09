/**
 * P22-05 — the quick entry's form as data (P19-05 § 7.3): the checks before saving, the starting
 * form for a device, and the exact request body (the room confirmed vs changed; blank optionals
 * left out; the laboratory from the device, the list or typed).
 */
import { buildBody, deviceRoom, emptyForm, entryProblems, initialLabMode, todayDay, type EntryForm } from "../entry";
import { CD_IDS, device } from "@/tests/support/calibrationDatesFixtures";

const TODAY = "2026-10-09";
const form = (over: Partial<EntryForm> = {}): EntryForm => ({ ...emptyForm(device(), true, TODAY), ...over });

describe("P22-05 — quick entry form", () => {
  it("todayDay is the browser's calendar day, zero-padded", () => {
    expect(todayDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("deviceRoom: a room is a room; a store or no location is none", () => {
    expect(deviceRoom(device())).toEqual({ name: "Room 101", floor: "1" });
    expect(deviceRoom(device({ warehouse: { id: CD_IDS.location, name: "Main store", code: "S", kind: "store" } }))).toBeNull();
    expect(deviceRoom(device({ warehouse: { id: CD_IDS.location, name: "Room 9", code: "R9" } }))).toEqual({ name: "Room 9", floor: "" });
    expect(deviceRoom(device({ warehouse: null }))).toBeNull();
  });

  it("starts on the device's laboratory, else the list for a vendors reader, else typing", () => {
    expect(initialLabMode(device(), false)).toBe("device");
    expect(initialLabMode(device({ calibrationVendorId: null }), true)).toBe("list");
    expect(initialLabMode(device({ calibrationVendorId: null }), false)).toBe("typed");
    expect(emptyForm(device({ warehouse: null }), true, TODAY)).toMatchObject({ calibrationDate: TODAY, roomName: "", roomFloor: "", verdict: "unstated" });
  });

  it.each([
    [{ calibrationDate: "" }, ["dateMissing"]],
    [{ calibrationDate: "2026-10-10" }, ["dateFuture"]],
    [{ calibrationDate: "1989-12-31" }, ["dateTooOld"]],
    [{ dueDate: "2026-10-09" }, ["dueNotAfter"]],
    [{ dueDate: "", calibrationDate: "x" }, ["dateMissing"]],
    [{ labMode: "list" as const, vendorId: "" }, ["labMissing"]],
    [{ labMode: "typed" as const, labName: "  " }, ["labMissing"]],
    [{ roomName: " ", roomFloor: "2" }, ["floorWithoutRoom"]],
    [{ labMode: "typed" as const, labName: "Synthetic Lab", dueDate: "2027-10-09" }, []],
  ])("entryProblems(%j) = %j", (patch, expected) => {
    expect(entryProblems(form(patch), TODAY)).toEqual(expected);
  });

  it("a confirmed, unchanged room sends the device's location; blank optionals are left out", () => {
    expect(buildBody(form(), device())).toEqual({ calibrationDate: TODAY, calibrationVendorId: CD_IDS.vendor, locationId: CD_IDS.location });
  });

  it("a changed room is sent as a room; the picked laboratory, certificate, due date, verdict and notes", () => {
    const body = buildBody(
      form({
        labMode: "list",
        vendorId: CD_IDS.otherVendor,
        certificateNumber: " C-9 ",
        dueDate: "2027-10-01",
        verdict: "non_compliant",
        roomName: "Room 202",
        roomFloor: "",
        notes: " moved ",
      }),
      device(),
    );
    expect(body).toEqual({
      calibrationDate: TODAY,
      calibrationVendorId: CD_IDS.otherVendor,
      certificateNumber: "C-9",
      dueDate: "2027-10-01",
      isCompliant: false,
      room: { name: "Room 202", floor: null },
      notes: "moved",
    });
  });

  it("a typed laboratory and a compliant verdict; no room when there is none", () => {
    const d = device({ warehouse: null, locationId: null, calibrationVendorId: null });
    expect(buildBody(form({ labMode: "typed", labName: " Synthetic Lab ", verdict: "compliant", roomName: "", roomFloor: "" }), d)).toEqual({
      calibrationDate: TODAY,
      externalLabName: "Synthetic Lab",
      isCompliant: true,
    });
    // "device" mode with no device laboratory sends none (the server then asks for one).
    expect(buildBody(form({ labMode: "device", roomName: "" }), d)).toEqual({ calibrationDate: TODAY });
    // A list pick with nothing picked sends none either.
    expect(buildBody(form({ labMode: "list", vendorId: "", roomName: "" }), d)).toEqual({ calibrationDate: TODAY });
  });

  it("a room on another floor is a change, sent with its floor", () => {
    expect(buildBody(form({ roomFloor: "2" }), device()).room).toEqual({ name: "Room 101", floor: "2" });
  });
});
