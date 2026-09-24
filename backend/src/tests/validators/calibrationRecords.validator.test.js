/**
 * Calibration Record validator tests
 */
const {
  validate,
  formatErrors,
  getCalibrationRecordsQuery,
  calibrationRecordIdSchema,
  calibrationDeviceIdSchema,
  createCalibrationRecordSchema,
  correctCalibrationRecordSchema,
  voidCalibrationRecordSchema,
} = require("../../validators/calibrationRecords.validator");

describe("Calibration Record Validators", () => {
  describe("getCalibrationRecordsQuery", () => {
    it("should validate query parameters and use defaults", () => {
      const data = {
        page: "3",
        limit: "10",
        deviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        isCompliant: "true",
        from: "2026-01-01",
        to: "2026-06-30",
      };

      const { error, value } = validate(data, getCalibrationRecordsQuery);

      expect(error).toBeUndefined();
      expect(value).toEqual({
        page: 3,
        limit: 10,
        deviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        isCompliant: true,
        from: new Date("2026-01-01"),
        to: new Date("2026-06-30"),
        includeSuperseded: false,
      });
    });

    it("should allow null isCompliant", () => {
      const data = {
        isCompliant: null,
      };
      const { error, value } = validate(data, getCalibrationRecordsQuery);
      expect(error).toBeUndefined();
      expect(value.isCompliant).toBeNull();
    });
  });

  describe("calibrationRecordIdSchema", () => {
    it("should validate uuid", () => {
      const data = {
        calibrationRecordId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };
      const { error } = validate(data, calibrationRecordIdSchema);
      expect(error).toBeUndefined();
    });
  });

  describe("calibrationDeviceIdSchema", () => {
    it("should validate uuid", () => {
      const data = {
        calibrationDeviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };
      const { error } = validate(data, calibrationDeviceIdSchema);
      expect(error).toBeUndefined();
    });
  });

  describe("createCalibrationRecordSchema", () => {
    it("should validate correct create parameters", () => {
      const data = {
        deviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        calibrationDate: "2026-06-01",
        dueDate: "2026-12-01",
        standard: "ISO 17025",
        results: { reading: 10.1, reference: 10.0 },
        isCompliant: true,
        certificateNumber: "CERT-999",
        certificateFileUrl: "http://example.com/cert.pdf",
        notes: "Perfect condition",
      };

      const { error, value } = validate(data, createCalibrationRecordSchema);

      expect(error).toBeUndefined();
      expect(value.deviceId).toBe("8c352a92-d6cf-4b71-b0db-6e69622d1b11");
    });
  });

  // P6-03 — correct and void each require a reason, and a blank one is
  // refused (the abuse case: a reason field that accepts an empty string).
  describe("correctCalibrationRecordSchema", () => {
    it("accepts corrected content with a reason, trimmed", () => {
      const { error, value } = validate(
        { notes: "Updated compliance note", isCompliant: false, reason: "  misread the dial  " },
        correctCalibrationRecordSchema,
      );
      expect(error).toBeUndefined();
      expect(value).toEqual({ notes: "Updated compliance note", isCompliant: false, reason: "misread the dial" });
    });

    it.each([
      ["missing", {}],
      ["empty", { reason: "" }],
      ["whitespace", { reason: "    " }],
      ["too short", { reason: "ab" }],
      ["too long", { reason: "x".repeat(2001) }],
    ])("refuses a %s reason", (_label, body) => {
      const { error } = validate({ notes: "x", ...body }, correctCalibrationRecordSchema);
      expect(error).toBeDefined();
      expect(error.details[0].path).toEqual(["reason"]);
    });

    it("strips lifecycle fields a caller tries to set", () => {
      const { error, value } = validate(
        { reason: "misread", supersedesId: "x", supersededById: "y", isDeleted: true, tenantId: "t" },
        correctCalibrationRecordSchema,
      );
      expect(error).toBeUndefined();
      expect(value).toEqual({ reason: "misread" });
    });
  });

  describe("voidCalibrationRecordSchema", () => {
    it("accepts a reason", () => {
      const { error, value } = validate({ reason: "entered twice" }, voidCalibrationRecordSchema);
      expect(error).toBeUndefined();
      expect(value).toEqual({ reason: "entered twice" });
    });

    it.each([[{}], [{ reason: "" }], [{ reason: "   " }]])("refuses %j", (body) => {
      expect(validate(body, voidCalibrationRecordSchema).error).toBeDefined();
    });

    it("refuses a request with no body at all (A-09: Express 5 leaves it undefined)", () => {
      expect(validate(undefined, voidCalibrationRecordSchema).error.details[0].path).toEqual(["reason"]);
    });
  });

  describe("formatErrors", () => {
    it("should format errors", () => {
      const details = [{ path: ["notes"], message: "Notes must be a string" }];
      const formatted = formatErrors(details);
      expect(formatted).toEqual([{ field: "notes", message: "Notes must be a string" }]);
    });
  });
});
