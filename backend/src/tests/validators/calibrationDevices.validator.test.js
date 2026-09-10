/**
 * Calibration Device validator tests
 */
const {
  validate,
  formatErrors,
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

      const { error, value } = validate(data, getCalibrationDevicesQuery);

      expect(error).toBeUndefined();
      expect(value).toEqual({
        page: 2,
        limit: 15,
        find: "calib",
        status: "active",
        category: "thermom",
      });
    });

    it("should reject invalid status", () => {
      const data = {
        status: "invalid",
      };
      const { error } = validate(data, getCalibrationDevicesQuery);
      expect(error).toBeDefined();
    });
  });

  describe("calibrationDeviceIdSchema", () => {
    it("should validate correct uuid", () => {
      const data = {
        calibrationDeviceId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      };
      const { error } = validate(data, calibrationDeviceIdSchema);
      expect(error).toBeUndefined();
    });

    it("should reject invalid uuid", () => {
      const data = {
        calibrationDeviceId: "not-a-uuid",
      };
      const { error } = validate(data, calibrationDeviceIdSchema);
      expect(error).toBeDefined();
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

      const { error, value } = validate(data, createCalibrationDeviceSchema);

      expect(error).toBeUndefined();
      expect(value.status).toBe("active");
      expect(value.name).toBe("Thermometer A");
    });

    it("should reject missing required field name", () => {
      const data = {
        serialNumber: "SN123",
      };
      const { error } = validate(data, createCalibrationDeviceSchema);
      expect(error).toBeDefined();
    });
  });

  describe("updateCalibrationDeviceSchema", () => {
    it("should validate partial update data", () => {
      const data = {
        name: "Thermometer Updated",
        status: "MAINTENANCE",
      };

      const { error, value } = validate(data, updateCalibrationDeviceSchema);

      expect(error).toBeUndefined();
      expect(value.name).toBe("Thermometer Updated");
      expect(value.status).toBe("maintenance");
    });
  });

  describe("formatErrors", () => {
    it("should format validation errors correctly", () => {
      const details = [
        { path: ["name"], message: "Name is required" },
        { path: ["status"], message: "Status is invalid" },
      ];
      const formatted = formatErrors(details);
      expect(formatted).toEqual([
        { field: "name", message: "Name is required" },
        { field: "status", message: "Status is invalid" },
      ]);
    });
  });
});
