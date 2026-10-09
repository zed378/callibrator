/**
 * P21-02a / P21-05 (ADR-132 § 1, ADR-133 § 1, § 4; specs P19-03 § 4.2, § 5, § 13; P19-05 § 5, § 6,
 * § 12; P19-08 § 7.2): the QR normalisation, the device contracts (bound and unbound), the next
 * due date's derivation, "calibration due" and its list window, the quick entry's contract.
 * Synthetic values only (prefix `TST`).
 */
import {
  CALIBRATION_DUE_FILTERS,
  CALIBRATION_DUE_STATES,
  DEVICE_CONFLICT_CODES,
  FIELD_DEVICE_SUMMARY_KEYS,
  calibrationDueWindow,
  computeCalibrationDue,
  deriveNextCalibrationDate,
  normaliseQrCode,
  zonedDayNumber,
  zonedDayStart,
} from "@callibrator/contracts/deviceValues";
import {
  createCalibrationDeviceBoundSchema,
  createCalibrationDeviceSchema,
  dayText,
  deviceQrParams,
  getCalibrationDevicesQuery,
  updateCalibrationDeviceBoundSchema,
  updateCalibrationDeviceSchema,
} from "@callibrator/contracts/calibrationDevices";
import { calibrationDateEntry } from "@callibrator/contracts/calibrationRecords";

const TST = { prefix: "TST", digits: 6 } as const;
const D = (iso: string): Date => new Date(iso);
const DEVICE = "d1000000-0000-4000-8000-0000000000f1";
const ROOM = "a0000000-0000-4000-8000-0000000000f1";

describe("normaliseQrCode (spec § 4.2)", () => {
  it("trims, removes inner spaces, upper-cases", () => {
    expect(normaliseQrCode("  tst 00 0001 ", TST)).toEqual({ ok: true, value: "TST000001" });
    expect(normaliseQrCode("skp-001234", { prefix: null, digits: 6 })).toEqual({ ok: true, value: "SKP-001234" });
  });

  it("pads a bare number with the tenant's prefix and digits", () => {
    expect(normaliseQrCode("42", TST)).toEqual({ ok: true, value: "TST000042" });
    expect(normaliseQrCode("123456", TST)).toEqual({ ok: true, value: "TST123456" });
  });

  it("refuses a number longer than the digits (never silently loses digits)", () => {
    expect(normaliseQrCode("1234567", TST)).toEqual({ ok: false, message: "This QR number is longer than 6 digits." });
  });

  it("keeps a bare number as typed without a prefix", () => {
    expect(normaliseQrCode("000042", { prefix: null, digits: 6 })).toEqual({ ok: true, value: "000042" });
  });

  it("refuses what is no QR after normalisation", () => {
    for (const bad of ["", "AB", "-ABC", "A_B_C", "X".repeat(33)]) {
      expect(normaliseQrCode(bad, TST)).toEqual({ ok: false, message: "A QR code holds 3 to 32 letters, digits or hyphens." });
    }
  });

  it("is idempotent", () => {
    for (const raw of ["42", " tst000042", "skp-9", "ABC"]) {
      const once = normaliseQrCode(raw, TST);
      expect(once.ok).toBe(true);
      if (once.ok) {
        expect(normaliseQrCode(once.value, TST)).toEqual(once);
      }
    }
  });
});

describe("the device contracts (spec § 5, § 6.3, § 8)", () => {
  it("the bound contracts refuse a QR, a status and a vendor (strict) and unknown keys", () => {
    for (const extra of [{ qrCode: "TST000001" }, { status: "active" }, { calibrationVendorId: DEVICE }, { tenantId: DEVICE }]) {
      expect(createCalibrationDeviceBoundSchema.safeParse({ name: "Pompa", ...extra }).success).toBe(false);
      expect(updateCalibrationDeviceBoundSchema.safeParse({ name: "Pompa", ...extra }).success).toBe(false);
    }
    expect(createCalibrationDeviceBoundSchema.safeParse({ name: "Pompa", room: { name: "Ruang 1" }, condition: "good" }).success).toBe(true);
  });

  it("a location is an id or a room, never both", () => {
    const both = { name: "Pompa", locationId: ROOM, room: { name: "Ruang 1" } };
    expect(createCalibrationDeviceSchema.safeParse(both).success).toBe(false);
    expect(updateCalibrationDeviceSchema.safeParse(both).success).toBe(false);
    expect(createCalibrationDeviceSchema.safeParse({ ...both, locationId: "" }).success).toBe(true);
    expect(createCalibrationDeviceSchema.safeParse({ ...both, locationId: null }).success).toBe(true);
    expect(createCalibrationDeviceSchema.safeParse({ name: "Pompa", locationId: ROOM }).success).toBe(true);
  });

  it("the register fields: inventory date on or after 1990, condition, interval 0 – 60, clientRef a uuid", () => {
    const ok = createCalibrationDeviceSchema.safeParse({
      name: "Pompa",
      inventoriedOn: "2024-02-29",
      condition: "not_good",
      ipmIntervalMonths: "0",
      accessoriesComplete: "true",
      clientRef: "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c",
    });
    expect(ok.success).toBe(true);
    for (const bad of [{ inventoriedOn: "1989-12-31" }, { inventoriedOn: "2026-13-01" }, { inventoriedOn: "2026-1-1" }, { ipmIntervalMonths: 61 }, { condition: "fine" }]) {
      expect(createCalibrationDeviceSchema.safeParse({ name: "Pompa", ...bad }).success).toBe(false);
    }
    expect(updateCalibrationDeviceSchema.safeParse({ clientFacilityId: DEVICE }).success).toBe(true);
  });

  it("dayText keeps a real calendar day as text", () => {
    expect(dayText().parse("2026-10-09")).toBe("2026-10-09");
    expect(dayText().safeParse("2026-02-31").success).toBe(false);
  });

  it("the list query: up to 200, the register's filters, the views and sorts", () => {
    const q = getCalibrationDevicesQuery.parse({ limit: "200", qrCode: " tst1 ", condition: "good", calibrationDue: "due_soon", view: "field", sort: "id" });
    expect(q).toMatchObject({ limit: 200, qrCode: "tst1", condition: "good", calibrationDue: "due_soon", view: "field", sort: "id" });
    expect(getCalibrationDevicesQuery.safeParse({ limit: "201" }).success).toBe(false);
    expect(deviceQrParams.safeParse({ qrCode: "" }).success).toBe(false);
  });

  it("the field summary's keys and the conflict codes are pinned", () => {
    expect(FIELD_DEVICE_SUMMARY_KEYS).toHaveLength(18);
    expect(FIELD_DEVICE_SUMMARY_KEYS).not.toContain("registrantSnapshot");
    expect(DEVICE_CONFLICT_CODES.qrTaken).toBe("DEVICE_QR_TAKEN");
    expect(CALIBRATION_DUE_STATES).toEqual(["not_scheduled", "requested", "overdue", "due_soon", "ok"]);
    expect(CALIBRATION_DUE_FILTERS).toEqual(["overdue", "due_soon", "requested"]);
  });
});

describe("deriveNextCalibrationDate (P19-05 § 5)", () => {
  const manual = { date: D("2030-01-01T00:00:00Z"), source: "manual" as const };
  it("no effective record: a `record` date is cleared, a `manual` one kept", () => {
    expect(deriveNextCalibrationDate({ current: { date: D("2027-01-01T00:00:00Z"), source: "record" }, intervalDays: 365, latest: null })).toEqual({ date: null, source: null });
    expect(deriveNextCalibrationDate({ current: manual, intervalDays: 365, latest: null })).toBe(manual);
  });
  it("the stated due date wins; else date + interval; else unchanged", () => {
    const latest = { calibrationDate: D("2026-06-01T00:00:00Z"), dueDate: D("2026-12-01T00:00:00Z") };
    expect(deriveNextCalibrationDate({ current: manual, intervalDays: 365, latest })).toEqual({ date: latest.dueDate, source: "record" });
    expect(deriveNextCalibrationDate({ current: manual, intervalDays: 365, latest: { ...latest, dueDate: null } })).toEqual({ date: D("2027-06-01T00:00:00Z"), source: "record" });
    expect(deriveNextCalibrationDate({ current: manual, intervalDays: null, latest: { ...latest, dueDate: null } })).toBe(manual);
    expect(deriveNextCalibrationDate({ current: manual, intervalDays: 0, latest: { ...latest, dueDate: null } })).toBe(manual);
  });
});

describe("computeCalibrationDue (P19-05 § 6)", () => {
  const base = {
    status: "active",
    nextCalibrationDate: D("2026-10-20T00:00:00Z"),
    source: "record" as const,
    requestedAt: null,
    requestedBySessionId: null,
    today: D("2026-10-09T12:00:00Z"),
    timeZone: "UTC",
    dueSoonDays: 30,
  };
  it("retired, inactive or deleted: not scheduled", () => {
    expect(computeCalibrationDue({ ...base, status: "retired" }).state).toBe("not_scheduled");
    expect(computeCalibrationDue({ ...base, status: "inactive" }).state).toBe("not_scheduled");
    expect(computeCalibrationDue({ ...base, deleted: true }).state).toBe("not_scheduled");
  });
  it("an IPM request wins over the date", () => {
    expect(computeCalibrationDue({ ...base, requestedAt: D("2026-10-01T00:00:00Z"), requestedBySessionId: DEVICE })).toEqual({
      state: "requested",
      nextCalibrationDate: "2026-10-20",
      source: "record",
      requestedBySessionId: DEVICE,
    });
  });
  it("no date: not scheduled; past: overdue; within the window: due soon; later: ok", () => {
    expect(computeCalibrationDue({ ...base, nextCalibrationDate: null, source: null }).state).toBe("not_scheduled");
    expect(computeCalibrationDue({ ...base, nextCalibrationDate: D("2026-10-08T23:00:00Z") }).state).toBe("overdue");
    expect(computeCalibrationDue({ ...base, nextCalibrationDate: D("2026-10-09T00:00:00Z") }).state).toBe("due_soon");
    expect(computeCalibrationDue({ ...base, nextCalibrationDate: D("2026-11-08T00:00:00Z") }).state).toBe("due_soon");
    expect(computeCalibrationDue({ ...base, nextCalibrationDate: D("2026-11-09T00:00:00Z") }).state).toBe("ok");
  });
  it("the days are the tenant zone's (Asia/Jakarta, UTC+7)", () => {
    // 2026-10-08T18:00Z is already 2026-10-09 in Jakarta: today, not overdue.
    expect(computeCalibrationDue({ ...base, timeZone: "Asia/Jakarta", nextCalibrationDate: D("2026-10-08T18:00:00Z") }).state).toBe("due_soon");
    expect(zonedDayNumber(D("2026-10-08T18:00:00Z"), "Asia/Jakarta").text).toBe("2026-10-09");
  });
  it("the list window matches the same days", () => {
    const w = calibrationDueWindow(D("2026-10-09T12:00:00Z"), "Asia/Jakarta", 30);
    expect(w.todayStart.toISOString()).toBe("2026-10-08T17:00:00.000Z");
    expect(w.soonEnd.toISOString()).toBe("2026-11-08T17:00:00.000Z");
    expect(zonedDayStart(0, "UTC").toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("calibrationDateEntry (P19-05 § 7.2)", () => {
  const ok = { calibrationDeviceId: DEVICE, calibrationDate: "2026-10-01", externalLabName: "Lab Sintetis" };
  it("accepts the key data; strict; the due date after the calibration date; one location", () => {
    expect(calibrationDateEntry.safeParse({ ...ok, dueDate: "2027-10-01", certificateNumber: "C-1", isCompliant: true, room: { name: "Ruang 1" } }).success).toBe(true);
    expect(calibrationDateEntry.safeParse({ ...ok, results: {} }).success).toBe(false);
    expect(calibrationDateEntry.safeParse({ ...ok, dueDate: "2026-10-01" }).success).toBe(false);
    expect(calibrationDateEntry.safeParse({ ...ok, locationId: ROOM, room: { name: "Ruang 1" } }).success).toBe(false);
    expect(calibrationDateEntry.safeParse({ ...ok, calibrationDate: "1/10/2026" }).success).toBe(false);
  });
});
