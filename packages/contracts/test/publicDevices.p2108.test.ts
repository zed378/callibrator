/**
 * P21-08 — the public device page's contract (ADR-138, Am. 1; spec
 * MEMORY/specs/P19-07-public-device-page.md § 4, § 8, § 9): the token's shape, the setting read
 * fail-closed, the public status mapping, the strict schemas.
 */
import {
  PUBLIC_CALIBRATION_STATUSES,
  PUBLIC_DEVICE_CODES,
  PUBLIC_DEVICE_PAGE_MODES,
  PUBLIC_DEVICE_TOKEN,
  PUBLIC_DEVICE_TOKEN_REVOKED_REASONS,
  parsePublicDevicePageMode,
  publicCalibrationStatus,
  publicDeviceParams,
  publicDeviceTokenParams,
  publicDeviceView,
} from "@callibrator/contracts/publicDevices";

describe("@callibrator/contracts/publicDevices", () => {
  it("the token: exactly 22 base64url characters", () => {
    expect(["Zx3kQ9vN2mP4rT6wY8aC1d", "_-_-_-_-_-_-_-_-_-_-_-"].map((t) => PUBLIC_DEVICE_TOKEN.test(t))).toEqual([true, true]);
    expect(["Zx3kQ9vN2mP4rT6wY8aC1", "Zx3kQ9vN2mP4rT6wY8aC1dd", "Zx3kQ9vN2mP4rT6wY8aC1=", "Zx3kQ9vN2mP4rT6wY8aC/d"].map((t) => PUBLIC_DEVICE_TOKEN.test(t))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("the setting: off first; anything else stored reads as off (fail closed)", () => {
    expect(PUBLIC_DEVICE_PAGE_MODES).toEqual(["off", "minimal", "minimal_with_report"]);
    expect([undefined, null, "", "MINIMAL", "public", "minimal", "minimal_with_report"].map((v) => parsePublicDevicePageMode(v))).toEqual([
      "off",
      "off",
      "off",
      "off",
      "off",
      "minimal",
      "minimal_with_report",
    ]);
  });

  it("the public status: retired from the device; otherwise from the house state, a request reading due soon", () => {
    expect(publicCalibrationStatus("retired", "ok")).toBe("retired");
    expect((["ok", "due_soon", "requested", "overdue", "not_scheduled"] as const).map((d) => publicCalibrationStatus("active", d))).toEqual([
      "current",
      "due_soon",
      "due_soon",
      "overdue",
      "not_scheduled",
    ]);
    expect(PUBLIC_CALIBRATION_STATUSES).toEqual(["current", "due_soon", "overdue", "retired", "not_scheduled"]);
  });

  it("the codes and revoke reasons", () => {
    expect(PUBLIC_DEVICE_CODES).toEqual({ notFound: "PUBLIC_DEVICE_NOT_FOUND", tokenActive: "PUBLIC_TOKEN_ACTIVE", tokenNone: "PUBLIC_TOKEN_NONE" });
    expect(PUBLIC_DEVICE_TOKEN_REVOKED_REASONS).toEqual(["rotated", "revoked", "device_deleted"]);
  });

  it("the params: a malformed token is not a 400 (the service answers the 404); a device id is a UUID", () => {
    expect(publicDeviceParams.safeParse({ token: "x" }).success).toBe(true);
    expect(publicDeviceParams.safeParse({ token: "x".repeat(2049) }).success).toBe(false);
    expect(publicDeviceTokenParams.safeParse({ calibrationDeviceId: "not-a-uuid" }).success).toBe(false);
  });

  it("the view is strict: an extra field (a serial) is refused", () => {
    const view = {
      device: { name: "Alat", type: null, manufacturer: null, model: null },
      facility: { name: "Facility One" },
      calibration: { status: "current", nextDueDate: "2027-01-01" },
      lastIpmDate: null,
      report: null,
    };
    expect(publicDeviceView.safeParse(view).success).toBe(true);
    expect(publicDeviceView.safeParse({ ...view, device: { ...view.device, serialNumber: "SN-1" } }).success).toBe(false);
  });
});
