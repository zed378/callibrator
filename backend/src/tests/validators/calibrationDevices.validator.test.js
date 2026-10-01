/**
 * Calibration Device validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod, exercised through the shared
 * `checkInput` helper (the file's own `validate` / `formatErrors` are gone).
 */
const { checkInput } = require("../../validators/input");
const {
  getCalibrationDevicesQuery,
  calibrationDeviceIdSchema,
  createCalibrationDeviceSchema,
  updateCalibrationDeviceSchema,
} = require("../../validators/calibrationDevices.validator");

describe("Calibration Device Validators", () => {
  describe("getCalibrationDevicesQuery", () => {
    it("should validate correct query parameters and apply defaults", () => {
      const data = {
        page: "2",
        limit: "15",
        find: "calib",
        status: "ACTIVE",
        category: "thermom",
      };

      const result = checkInput(data, getCalibrationDevicesQuery);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({
        page: 2,
        limit: 15,
        find: "calib",
        status: "active",
        category: "thermom",
      });
    });

    it("defaults page and limit on an empty query", () => {
      expect(checkInput({}, getCalibrationDevicesQuery)).toEqual({ ok: true, value: { page: 1, limit: 20 } });
    });

    it("refuses a page below 1 and a limit above 100", () => {
      expect(checkInput({ page: "0", limit: "101" }, getCalibrationDevicesQuery).errors).toEqual([
        { field: "page", message: "Too small: expected number to be >=1" },
        { field: "limit", message: "Too big: expected number to be <=100" },
      ]);
    });

    it("should reject invalid status", () => {
      const result = checkInput({ status: "invalid" }, getCalibrationDevicesQuery);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "status", message: "Invalid input" }]);
    });
  });

  describe("calibrationDeviceIdSchema", () => {
    it("should validate correct uuid", () => {
      const data = {
        calibrationDeviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };
      expect(checkInput(data, calibrationDeviceIdSchema).ok).toBe(true);
    });

    it("should reject invalid uuid", () => {
      const result = checkInput({ calibrationDeviceId: "not-a-uuid" }, calibrationDeviceIdSchema);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([{ field: "calibrationDeviceId", message: "Invalid GUID" }]);
    });
  });

  describe("createCalibrationDeviceSchema", () => {
    it("should validate correct data and apply default status", () => {
      const data = {
        name: "Thermometer A",
        serialNumber: "SN123",
        manufacturer: "Fluke",
        model: "51-II",
        category: "Temperature",
        locationId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        installationDate: "2026-01-01",
        nextCalibrationDate: "2026-07-01",
        calibrationIntervalDays: 180,
        remarks: "Main thermometer",
      };

      const result = checkInput(data, createCalibrationDeviceSchema);

      expect(result.ok).toBe(true);
      expect(result.value.status).toBe("active");
      expect(result.value.name).toBe("Thermometer A");
      expect(result.value.installationDate).toEqual(new Date("2026-01-01"));
    });

    it("accepts empty strings and null for the optional fields, and a numeric-string interval", () => {
      const result = checkInput(
        {
          name: "  Thermometer A  ",
          serialNumber: "",
          locationId: "",
          installationDate: "",
          nextCalibrationDate: null,
          calibrationIntervalDays: "180",
          remarks: null,
        },
        createCalibrationDeviceSchema,
      );

      expect(result).toEqual({
        ok: true,
        value: {
          name: "Thermometer A",
          serialNumber: "",
          status: "active",
          locationId: "",
          installationDate: "",
          nextCalibrationDate: null,
          calibrationIntervalDays: 180,
          remarks: null,
        },
      });
    });

    it("should reject missing required field name", () => {
      const result = checkInput({ serialNumber: "SN123" }, createCalibrationDeviceSchema);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
      ]);
    });
  });

  describe("updateCalibrationDeviceSchema", () => {
    it("should validate partial update data", () => {
      const data = {
        name: "Thermometer Updated",
        status: "MAINTENANCE",
      };

      const result = checkInput(data, updateCalibrationDeviceSchema);

      expect(result.ok).toBe(true);
      expect(result.value.name).toBe("Thermometer Updated");
      expect(result.value.status).toBe("maintenance");
    });

    it("refuses an interval below one day", () => {
      expect(checkInput({ calibrationIntervalDays: 0 }, updateCalibrationDeviceSchema).errors).toEqual([
        { field: "calibrationIntervalDays", message: "Too small: expected number to be >=1" },
      ]);
    });
  });
});
