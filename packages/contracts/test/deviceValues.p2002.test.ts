/**
 * P20-02 / P20-08 (ADR-132, ADR-133; P19-03 § 4, § 6, § 7.1; P19-05 § 4) — the device register's
 * and the calibration dates' vocabularies. The backend's ENUM columns and CHECKs are held equal to
 * these by enumMirrors.d26 and the migrations' tests; here the values themselves are pinned, in
 * their order (the order `sync` and migrations 0128/0129 create each type in).
 */
import {
  ATTACHMENT_PURPOSES,
  CALIBRATION_ENTRY_KINDS,
  DEVICE_CONDITION_SOURCES,
  DEVICE_CONDITIONS,
  INVENTORIED_ON_MIN,
  IPM_INTERVAL_MONTHS_MAX,
  NEXT_CALIBRATION_DATE_SOURCES,
  QR_CODE_PATTERN,
  SINGLE_DEVICE_PHOTO_PURPOSES,
  WAREHOUSE_KINDS,
} from "@callibrator/contracts/deviceValues";

describe("P20-02 / P20-08 — device and calibration-date vocabularies", () => {
  it("the condition (spec § 4.4) and its source; a room or a store", () => {
    expect(DEVICE_CONDITIONS).toEqual(["good", "not_good", "broken"]);
    expect(DEVICE_CONDITION_SOURCES).toEqual(["registration", "manual", "import"]);
    expect(WAREHOUSE_KINDS).toEqual(["store", "room"]);
  });

  it("the calibration entry kinds and the next date's sources (P19-05 § 4)", () => {
    expect(CALIBRATION_ENTRY_KINDS).toEqual(["full_record", "external_date"]);
    expect(NEXT_CALIBRATION_DATE_SOURCES).toEqual(["manual", "record"]);
  });

  it("the photo purposes; one live front and serial-plate photo per device", () => {
    expect(ATTACHMENT_PURPOSES).toEqual(["device_front", "device_serial_plate", "device_other", "ipm_evidence"]);
    expect(SINGLE_DEVICE_PHOTO_PURPOSES).toEqual(["device_front", "device_serial_plate"]);
    expect(SINGLE_DEVICE_PHOTO_PURPOSES.every((p) => (ATTACHMENT_PURPOSES as readonly string[]).includes(p))).toBe(true);
  });

  it("the QR pattern accepts normalised stickers (3 – 32 of A-Z, 0-9, -) and refuses the rest", () => {
    const qr = new RegExp(QR_CODE_PATTERN);
    for (const ok of ["TST000001", "SKP-001234", "A1B", "9".repeat(32)]) {
      expect(qr.test(ok)).toBe(true);
    }
    for (const bad of ["tst000001", "-AB", "AB", "A B C", "9".repeat(33), "TST_01"]) {
      expect(qr.test(bad)).toBe(false);
    }
  });

  it("the limits: IPM interval 0 – 60 months, inventory dates from 1990", () => {
    expect(IPM_INTERVAL_MONTHS_MAX).toBe(60);
    expect(INVENTORIED_ON_MIN).toBe("1990-01-01");
  });

  it("every tuple is frozen", () => {
    for (const tuple of [
      DEVICE_CONDITIONS,
      DEVICE_CONDITION_SOURCES,
      WAREHOUSE_KINDS,
      CALIBRATION_ENTRY_KINDS,
      NEXT_CALIBRATION_DATE_SOURCES,
      ATTACHMENT_PURPOSES,
      SINGLE_DEVICE_PHOTO_PURPOSES,
    ]) {
      expect(Object.isFrozen(tuple)).toBe(true);
    }
  });
});
