/**
 * Tests for calibrationDevices.service.js
 */

jest.mock("sequelize", () => ({
  Op: {
    or: Symbol("or"),
    iLike: Symbol("iLike"),
  },
}));

jest.mock("../../models", () => ({
  CalibrationDevice: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../validators/calibrationDevices.validator", () => ({
  createCalibrationDeviceSchema: {
    validate: jest.fn(),
  },
  updateCalibrationDeviceSchema: {
    validate: jest.fn(),
  },
}));

const { CalibrationDevice } = require("../../models");
const validator = require("../../validators/calibrationDevices.validator");
const {
  fetchCalibrationDevices,
  fetchSpecificCalibrationDevice,
  createCalibrationDevice,
  updateCalibrationDevice,
  deleteCalibrationDevice,
  bulkImportCalibrationDevices,
} = require("../../services/calibrationDevices.service");

describe("calibrationDevices.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchCalibrationDevices", () => {
    it("should fetch calibration devices successfully without query params", async () => {
      CalibrationDevice.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "device-1", name: "Device 1" }],
        count: 1,
      });

      const result = await fetchCalibrationDevices({ tenantId: "tenant-1" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.meta.total).toBe(1);
    });

    it("should fetch with query params (find, status, category)", async () => {
      CalibrationDevice.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "device-1", name: "Search Device" }],
        count: 1,
      });

      const result = await fetchCalibrationDevices({
        tenantId: "tenant-1",
        find: "search",
        status: "ACTIVE",
        category: "Temp",
        page: 2,
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(CalibrationDevice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            status: "active",
            category: "Temp",
          }),
          limit: 5,
          offset: 5,
        }),
      );
    });

    it("should handle error during fetching", async () => {
      CalibrationDevice.findAndCountAll.mockRejectedValueOnce(new Error("Db error"));
      await expect(
        fetchCalibrationDevices({ tenantId: "tenant-1" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("fetchSpecificCalibrationDevice", () => {
    it("should fetch a specific device successfully", async () => {
      CalibrationDevice.findOne.mockResolvedValueOnce({
        id: "device-1",
        name: "Device 1",
      });

      const result = await fetchSpecificCalibrationDevice("tenant-1", "device-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.name).toBe("Device 1");
    });

    it("should return 404 if device is not found", async () => {
      CalibrationDevice.findOne.mockResolvedValueOnce(null);

      const result = await fetchSpecificCalibrationDevice("tenant-1", "device-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    });

    it("should handle error during fetchSpecificCalibrationDevice", async () => {
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));
      await expect(
        fetchSpecificCalibrationDevice("tenant-1", "device-1"),
      ).rejects.toThrow("Db error");
    });
  });

  describe("createCalibrationDevice", () => {
    it("should throw a 400 error when validation fails", async () => {
      validator.createCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: {
          details: [{ path: ["name"], message: "Name is required" }],
        },
      });

      await expect(
        createCalibrationDevice("tenant-1", { serialNumber: "123" }),
      ).rejects.toEqual(
        expect.objectContaining({
          status: 400,
          message: "Validation failed",
        }),
      );
    });

    it("should return 409 if device serial number already exists", async () => {
      validator.createCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        value: { name: "Device A", serialNumber: "SN123" },
      });
      CalibrationDevice.findOne.mockResolvedValueOnce({
        id: "existing-device",
        serialNumber: "SN123",
      });

      const result = await createCalibrationDevice("tenant-1", {
        name: "Device A",
        serialNumber: "SN123",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(409);
      expect(result.message).toContain("already exists");
    });

    it("skips the duplicate lookup entirely when no serialNumber is supplied", async () => {
      validator.createCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        value: { name: "Device A" },
      });
      CalibrationDevice.create.mockResolvedValueOnce({ id: "dev-new", name: "Device A" });

      const result = await createCalibrationDevice("tenant-1", { name: "Device A" });

      // A null serialNumber must never be used as a WHERE parameter.
      expect(CalibrationDevice.findOne).not.toHaveBeenCalled();
      expect(result.status).toBe(201);
      expect(CalibrationDevice.create).toHaveBeenCalledWith({
        name: "Device A",
        tenantId: "tenant-1",
      });
    });

    it("should create device successfully if all valid", async () => {
      const inputData = { name: "Device A", serialNumber: "SN123" };
      validator.createCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        value: inputData,
      });
      CalibrationDevice.findOne.mockResolvedValueOnce(null);
      CalibrationDevice.create.mockResolvedValueOnce({
        id: "new-device",
        ...inputData,
      });

      const result = await createCalibrationDevice("tenant-1", inputData);

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(result.data.id).toBe("new-device");
    });

    it("should handle error during create", async () => {
      validator.createCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        // Include a serialNumber so the duplicate-check findOne runs (and can reject).
        value: { name: "Device A", serialNumber: "SN-A" },
      });
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        createCalibrationDevice("tenant-1", {
          name: "Device A",
          serialNumber: "SN-A",
        }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("updateCalibrationDevice", () => {
    it("should throw a 400 error when validation fails", async () => {
      validator.updateCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: {
          details: [{ path: ["name"], message: "Name must be string" }],
        },
      });

      await expect(
        updateCalibrationDevice("tenant-1", "device-1", { name: 123 }),
      ).rejects.toEqual(
        expect.objectContaining({
          status: 400,
        }),
      );
    });

    it("should return 404 if device is not found", async () => {
      validator.updateCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        value: { name: "Updated Name" },
      });
      CalibrationDevice.findOne.mockResolvedValueOnce(null);

      const result = await updateCalibrationDevice("tenant-1", "device-1", {
        name: "Updated Name",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should update device successfully", async () => {
      validator.updateCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        value: { name: "Updated Name" },
      });
      const mockDevice = {
        id: "device-1",
        name: "Device 1",
        update: jest.fn().mockResolvedValueOnce(true),
      };
      CalibrationDevice.findOne.mockResolvedValueOnce(mockDevice);

      const result = await updateCalibrationDevice("tenant-1", "device-1", {
        name: "Updated Name",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockDevice.update).toHaveBeenCalledWith({ name: "Updated Name" });
    });

    it("should handle error during update", async () => {
      validator.updateCalibrationDeviceSchema.validate.mockReturnValueOnce({
        error: null,
        value: { name: "Updated Name" },
      });
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        updateCalibrationDevice("tenant-1", "device-1", { name: "Updated Name" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("deleteCalibrationDevice", () => {
    it("should return 404 if device is not found", async () => {
      CalibrationDevice.findOne.mockResolvedValueOnce(null);

      const result = await deleteCalibrationDevice("tenant-1", "device-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should delete device successfully", async () => {
      const mockDevice = {
        id: "device-1",
        softDelete: jest.fn().mockResolvedValueOnce(true),
      };
      CalibrationDevice.findOne.mockResolvedValueOnce(mockDevice);

      const result = await deleteCalibrationDevice("tenant-1", "device-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockDevice.softDelete).toHaveBeenCalled();
    });

    it("should handle error during delete", async () => {
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        deleteCalibrationDevice("tenant-1", "device-1"),
      ).rejects.toThrow("Db error");
    });
  });

  describe("bulkImportCalibrationDevices", () => {
    const fs = require("fs");
    const path = require("path");
    const testCsvPath = path.join(__dirname, "test-import.csv");

    afterEach(() => {
      if (fs.existsSync(testCsvPath)) {
        fs.unlinkSync(testCsvPath);
      }
    });

    it("should return 400 if CSV has fewer than 2 rows", async () => {
      fs.writeFileSync(testCsvPath, "Device Name,Manufacturer,Model\n");
      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.message).toContain("must contain a header row");
      expect(result.data.successCount).toBe(0);
    });

    it("should successfully import valid devices, skip empty rows, and handle validation/duplicate errors", async () => {
      // Setup mock behavior for schema validation
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => {
        if (!data.name) {
          return {
            error: {
              details: [{ path: ["name"], message: "Name is required" }],
            },
            value: null,
          };
        }
        return { error: null, value: data };
      });

      // Existing DB devices for duplicate check
      CalibrationDevice.findAll.mockResolvedValueOnce([
        { serialNumber: "SN-DUPLICATE" },
      ]);

      // CSV Content:
      // Row 2: Valid device (will succeed)
      // Row 3: Empty row (will skip)
      // Row 4: Duplicate SN (will fail with duplicate error)
      // Row 5: Missing name (will fail with Joi validation error)
      const csvContent =
        "Device Name,Manufacturer,Model,Serial Number,Status\n" +
        "Valid Device,Manufacturer A,Model A,SN-100,active\n" +
        ",,,,\n" +
        "Duplicate Device,Manufacturer B,Model B,SN-DUPLICATE,active\n" +
        ",Manufacturer C,Model C,SN-200,active\n";

      fs.writeFileSync(testCsvPath, csvContent);

      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.successCount).toBe(1);
      expect(result.data.failedCount).toBe(2);
      expect(result.data.totalCount).toBe(3);

      expect(result.data.errors).toHaveLength(2);
      // Row 4 error should be serialNumber duplicate
      expect(result.data.errors[0].row).toBe(4);
      expect(result.data.errors[0].errors[0].field).toBe("serialNumber");
      // Row 5 error should be name required
      expect(result.data.errors[1].row).toBe(5);
      expect(result.data.errors[1].errors[0].field).toBe("name");

      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "Valid Device",
          manufacturer: "Manufacturer A",
          model: "Model A",
          serialNumber: "SN-100",
          status: "active",
          tenantId: "tenant-1",
        }),
      ]);
    });

    it("should handle db errors and throw", async () => {
      fs.writeFileSync(testCsvPath, "Device Name\nDevice A\n");
      CalibrationDevice.findAll.mockRejectedValueOnce(new Error("DB Connection Error"));

      await expect(
        bulkImportCalibrationDevices("tenant-1", testCsvPath),
      ).rejects.toThrow("DB Connection Error");
    });

    it("should cover all CSV parsing edge cases, CRLF, escaped quotes, last line without newline, and calibration interval conversions", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => ({
        error: null,
        value: data,
      }));

      CalibrationDevice.findAll.mockResolvedValueOnce([]);
      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      const csvContent =
        "Device Name,Manufacturer,Calibration Interval Days\r\n" +
        "\"Device \"\"Name\"\"\",Manufacturer A,30\r\n" +
        "Device B,Manufacturer B,";

      fs.writeFileSync(testCsvPath, csvContent);

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(result.success).toBe(true);
      expect(result.data.successCount).toBe(2);
      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'Device "Name"',
          manufacturer: "Manufacturer A",
          calibrationIntervalDays: 30,
        }),
        expect.objectContaining({
          name: "Device B",
          manufacturer: "Manufacturer B",
          calibrationIntervalDays: null,
        }),
      ]);
    });

    it("ignores a whitespace-only trailing fragment after the final newline", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => ({
        error: null,
        value: data,
      }));
      CalibrationDevice.findAll.mockResolvedValueOnce([]);
      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      // trailing "   " leaves a non-empty currentField that trims to "" with an
      // empty currentLine — it must not become a third, blank device row.
      fs.writeFileSync(testCsvPath, "Device Name\nDevice A\nDevice B\n   ");

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(result.data.successCount).toBe(2);
      expect(result.data.failedCount).toBe(0);
      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        expect.objectContaining({ name: "Device A" }),
        expect.objectContaining({ name: "Device B" }),
      ]);
    });

    it("skips blank lines in the middle of the file", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => ({
        error: null,
        value: data,
      }));
      CalibrationDevice.findAll.mockResolvedValueOnce([]);
      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      fs.writeFileSync(testCsvPath, "Device Name\nDevice A\n\nDevice B\n");

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      // The blank line must not become a third device or a validation error.
      expect(result.data.successCount).toBe(2);
      expect(result.data.failedCount).toBe(0);
      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        expect.objectContaining({ name: "Device A" }),
        expect.objectContaining({ name: "Device B" }),
      ]);
    });

    it("parses a final single-column row that has no trailing newline", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => ({
        error: null,
        value: data,
      }));
      CalibrationDevice.findAll.mockResolvedValueOnce([]);
      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      fs.writeFileSync(testCsvPath, "Device Name\nDevice A");

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(result.data.successCount).toBe(1);
      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        { name: "Device A", tenantId: "tenant-1" },
      ]);
    });

    it("ignores unmapped headers and columns missing from a short row", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => ({
        error: null,
        value: data,
      }));
      CalibrationDevice.findAll.mockResolvedValueOnce([]);
      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      // "Notes" maps to nothing; the row stops before the "Model" column.
      fs.writeFileSync(testCsvPath, "Device Name,Notes,Model\nDevice A,some note\n");

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(result.data.successCount).toBe(1);
      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        { name: "Device A", tenantId: "tenant-1" },
      ]);
    });

    it("passes a non-numeric calibration interval through unconverted so validation can reject it", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation((data) => ({
        error: null,
        value: data,
      }));
      CalibrationDevice.findAll.mockResolvedValueOnce([]);
      CalibrationDevice.bulkCreate.mockResolvedValueOnce([]);

      fs.writeFileSync(testCsvPath, "Device Name,Calibration Interval Days\nDevice A,not-a-number\n");

      await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(CalibrationDevice.bulkCreate).toHaveBeenCalledWith([
        expect.objectContaining({ calibrationIntervalDays: "not-a-number" }),
      ]);
    });

    it("does not call bulkCreate when every row fails validation", async () => {
      validator.createCalibrationDeviceSchema.validate.mockImplementation(() => ({
        error: { details: [{ path: ["name"], message: "Name is required" }] },
      }));
      CalibrationDevice.findAll.mockResolvedValueOnce([]);

      fs.writeFileSync(testCsvPath, "Device Name\nDevice A\n");

      const result = await bulkImportCalibrationDevices("tenant-1", testCsvPath);

      expect(CalibrationDevice.bulkCreate).not.toHaveBeenCalled();
      expect(result.data).toMatchObject({
        successCount: 0,
        failedCount: 1,
        totalCount: 1,
      });
      expect(result.data.errors[0]).toEqual({
        row: 2,
        errors: [{ field: "name", message: "Name is required" }],
      });
    });
  });
});
