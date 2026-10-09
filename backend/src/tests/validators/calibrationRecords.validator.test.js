/**
 * Calibration Record validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `checkInput` helper (the file's own `validate` / `formatErrors` are gone).
 */
const { checkInput } = require("../../validators/input");
const {
  getCalibrationRecordsQuery,
  calibrationRecordIdSchema,
  calibrationDeviceIdSchema,
  createCalibrationRecordSchema,
  correctCalibrationRecordSchema,
  voidCalibrationRecordSchema,
} = require("../../validators/calibrationRecords.validator");

const ID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";
const TOO_SHORT = "Too small: expected string to have >=3 characters";

describe("Calibration Record Validators", () => {
  describe("getCalibrationRecordsQuery", () => {
    it("should validate query parameters and use defaults", () => {
      const data = {
        page: "3",
        limit: "10",
        deviceId: ID,
        isCompliant: "true",
        from: "2026-01-01",
        to: "2026-06-30",
      };

      const result = checkInput(data, getCalibrationRecordsQuery);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({
        page: 3,
        limit: 10,
        deviceId: ID,
        isCompliant: true,
        from: new Date("2026-01-01"),
        to: new Date("2026-06-30"),
        includeSuperseded: false,
        // P21-06 (ADR-133 Am. 3): the recap parameters' defaults.
        dateField: "calibration",
        latestOnly: false,
      });
    });

    it("should allow null isCompliant", () => {
      const result = checkInput({ isCompliant: null }, getCalibrationRecordsQuery);
      expect(result.ok).toBe(true);
      expect(result.value.isCompliant).toBeNull();
    });

    it("converts includeSuperseded from text", () => {
      expect(checkInput({ includeSuperseded: "true" }, getCalibrationRecordsQuery).value.includeSuperseded).toBe(true);
    });
  });

  describe("calibrationRecordIdSchema", () => {
    it("should validate uuid", () => {
      expect(checkInput({ calibrationRecordId: ID }, calibrationRecordIdSchema).ok).toBe(true);
    });
  });

  describe("calibrationDeviceIdSchema", () => {
    it("should validate uuid", () => {
      expect(checkInput({ calibrationDeviceId: ID }, calibrationDeviceIdSchema).ok).toBe(true);
    });
  });

  describe("createCalibrationRecordSchema", () => {
    it("should validate correct create parameters", () => {
      const data = {
        deviceId: ID,
        calibrationDate: "2026-06-01",
        dueDate: "2026-12-01",
        standard: "ISO 17025",
        results: { reading: 10.1, reference: 10.0 },
        isCompliant: true,
        certificateNumber: "CERT-999",
        certificateFileUrl: "http://example.com/cert.pdf",
        notes: "Perfect condition",
      };

      const result = checkInput(data, createCalibrationRecordSchema);

      expect(result.ok).toBe(true);
      expect(result.value.deviceId).toBe(ID);
      expect(result.value.calibrationDate).toEqual(new Date("2026-06-01"));
    });

    it("defaults calibrationDate to now", () => {
      const before = Date.now();
      const result = checkInput({ deviceId: ID }, createCalibrationRecordSchema);

      expect(result.ok).toBe(true);
      expect(result.value.calibrationDate).toBeInstanceOf(Date);
      expect(result.value.calibrationDate.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("refuses results that are not an object and a certificate URL that is not a URL", () => {
      expect(
        checkInput({ deviceId: ID, results: [1], certificateFileUrl: "not a url" }, createCalibrationRecordSchema).errors,
      ).toEqual([
        { field: "results", message: "Invalid input" },
        { field: "certificateFileUrl", message: "Invalid URL" },
      ]);
    });
  });

  // P6-03 — correct and void each require a reason, and a blank one is
  // refused (the abuse case: a reason field that accepts an empty string).
  describe("correctCalibrationRecordSchema", () => {
    it("accepts corrected content with a reason, trimmed", () => {
      const result = checkInput(
        { notes: "Updated compliance note", isCompliant: false, reason: "  misread the dial  " },
        correctCalibrationRecordSchema,
      );
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ notes: "Updated compliance note", isCompliant: false, reason: "misread the dial" });
    });

    it("converts a numeric-string measurement uncertainty", () => {
      expect(checkInput({ reason: "abc", measurementUncertainty: "0.5" }, correctCalibrationRecordSchema).value).toEqual({
        reason: "abc",
        measurementUncertainty: 0.5,
      });
    });

    it.each([
      ["missing", {}, "Invalid input: expected string, received undefined"],
      ["empty", { reason: "" }, TOO_SHORT],
      ["whitespace", { reason: "    " }, TOO_SHORT],
      ["too short", { reason: "ab" }, TOO_SHORT],
      ["too long", { reason: "x".repeat(2001) }, "Too big: expected string to have <=2000 characters"],
    ])("refuses a %s reason", (_label, body, message) => {
      const result = checkInput({ notes: "x", ...body }, correctCalibrationRecordSchema);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "reason", message }]);
    });

    it("strips lifecycle fields a caller tries to set", () => {
      const result = checkInput(
        { reason: "misread", supersedesId: "x", supersededById: "y", isDeleted: true, tenantId: "t" },
        correctCalibrationRecordSchema,
      );
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ reason: "misread" });
    });
  });

  describe("voidCalibrationRecordSchema", () => {
    it("accepts a reason", () => {
      const result = checkInput({ reason: "entered twice" }, voidCalibrationRecordSchema);
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ reason: "entered twice" });
    });

    it.each([[{}], [{ reason: "" }], [{ reason: "   " }]])("refuses %j", (body) => {
      expect(checkInput(body, voidCalibrationRecordSchema).ok).toBe(false);
    });

    it("refuses a request with no body at all (A-09: Express 5 leaves it undefined)", () => {
      expect(checkInput(undefined, voidCalibrationRecordSchema).errors).toEqual([
        { field: "reason", message: "Invalid input: expected string, received undefined" },
      ]);
    });
  });
});
