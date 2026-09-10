/**
 * Tests for Calibration Devices Controller
 */

jest.mock("../../services/calibrationDevices.service", () => ({
  fetchCalibrationDevices: jest.fn(),
  fetchSpecificCalibrationDevice: jest.fn(),
  createCalibrationDevice: jest.fn(),
  updateCalibrationDevice: jest.fn(),
  deleteCalibrationDevice: jest.fn(),
  bulkImportCalibrationDevices: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("fs", () => ({
  unlink: jest.fn((path, cb) => cb && cb(null)),
}));

jest.mock("../../validators/calibrationDevices.validator", () => {
  const Joi = require("joi");
  return {
    getCalibrationDevicesQuery: Joi.object(),
    calibrationDeviceIdSchema: Joi.object(),
    createCalibrationDeviceSchema: Joi.object(),
    updateCalibrationDeviceSchema: Joi.object(),
    validate: jest.fn((data, schema) => {
      if (data.failValidation) {
        return {
          error: {
            details: [{ path: ["field"], message: "Validation error" }],
          },
          value: null,
        };
      }
      return { error: null, value: data };
    }),
  };
});

const calibrationDevicesController = require("../../controllers/calibrationDevices.controller");
const calibrationDevicesService = require("../../services/calibrationDevices.service");
const { success, error } = require("../../utils/response.util");
const { validate: validatorValidate } = require("../../validators/calibrationDevices.validator");

describe("calibrationDevicesController", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      user: { id: "user-1", tenantId: "tenant-1" },
      query: {},
      params: {},
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response, data, meta, message, status) => {
      response.status(status || 200).json({ success: true, data, meta, message });
    });
    error.mockImplementation((response, message, status) => {
      response.status(status || 500).json({ success: false, message });
    });
  });

  describe("getAllCalibrationDevices", () => {
    it("should fetch all devices successfully", async () => {
      calibrationDevicesService.fetchCalibrationDevices.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { rows: [{ id: "dev-1" }], meta: { total: 1 } },
      });

      await calibrationDevicesController.getAllCalibrationDevices(req, res);

      expect(calibrationDevicesService.fetchCalibrationDevices).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1" }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should call error response when validation fails", async () => {
      req.query = { failValidation: true };

      await calibrationDevicesController.getAllCalibrationDevices(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getSpecificCalibrationDevice", () => {
    it("should fetch device successfully", async () => {
      req.params = { calibrationDeviceId: "dev-1" };
      calibrationDevicesService.fetchSpecificCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "dev-1" },
      });

      await calibrationDevicesController.getSpecificCalibrationDevice(req, res);

      expect(calibrationDevicesService.fetchSpecificCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        "dev-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createCalibrationDevice", () => {
    it("should create device successfully", async () => {
      req.body = { name: "New Device" };
      calibrationDevicesService.createCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Success",
        data: { id: "dev-1", name: "New Device" },
      });

      await calibrationDevicesController.createCalibrationDevice(req, res);

      expect(calibrationDevicesService.createCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        { name: "New Device" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateCalibrationDevice", () => {
    it("should update device successfully", async () => {
      req.params = { calibrationDeviceId: "dev-1" };
      req.body = { name: "Updated Device" };
      calibrationDevicesService.updateCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "dev-1", name: "Updated Device" },
      });

      await calibrationDevicesController.updateCalibrationDevice(req, res);

      expect(calibrationDevicesService.updateCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        "dev-1",
        { name: "Updated Device" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteCalibrationDevice", () => {
    it("should delete device successfully", async () => {
      req.params = { calibrationDeviceId: "dev-1" };
      calibrationDevicesService.deleteCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: null,
      });

      await calibrationDevicesController.deleteCalibrationDevice(req, res);

      expect(calibrationDevicesService.deleteCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        "dev-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("bulkImportCalibrationDevices", () => {
    it("should call error response if no file is uploaded", async () => {
      req.file = null;
      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);
      expect(error).toHaveBeenCalled();
      expect(error.mock.calls[0][0]).toBe(res);
      expect(error.mock.calls[0][1]).toBe("No CSV file uploaded");
      expect(error.mock.calls[0][2]).toBe(400);
    });

    it("should import file successfully and delete the temp file", async () => {
      const fs = require("fs");
      req.file = { path: "temp-path/import.csv" };
      calibrationDevicesService.bulkImportCalibrationDevices.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { successCount: 5, failedCount: 0 },
      });

      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);

      expect(calibrationDevicesService.bulkImportCalibrationDevices).toHaveBeenCalledWith(
        "tenant-1",
        "temp-path/import.csv",
      );
      expect(success).toHaveBeenCalledWith(
        res,
        expect.objectContaining({ successCount: 5 }),
        null,
        "Success",
        200,
      );
      expect(fs.unlink).toHaveBeenCalledWith("temp-path/import.csv", expect.any(Function));
    });

    // The unlink callback logs only for real failures — a missing temp file
    // (ENOENT) is expected and must stay silent.
    it("logs when deleting the temp file fails for a reason other than ENOENT", async () => {
      const fs = require("fs");
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      fs.unlink.mockImplementation((path, cb) => cb({ code: "EACCES", message: "denied" }));
      req.file = { path: "temp-path/import.csv" };
      calibrationDevicesService.bulkImportCalibrationDevices.mockResolvedValue({
        success: true, status: 200, message: "Success", data: { successCount: 1, failedCount: 0 },
      });

      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to delete temp import file: temp-path/import.csv",
        expect.objectContaining({ code: "EACCES" }),
      );
      expect(success).toHaveBeenCalled();
      consoleSpy.mockRestore();
      fs.unlink.mockImplementation((path, cb) => cb && cb(null));
    });

    it("stays silent when the temp file is already gone (ENOENT)", async () => {
      const fs = require("fs");
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      fs.unlink.mockImplementation((path, cb) => cb({ code: "ENOENT" }));
      req.file = { path: "temp-path/import.csv" };
      calibrationDevicesService.bulkImportCalibrationDevices.mockResolvedValue({
        success: true, status: 200, message: "Success", data: { successCount: 1, failedCount: 0 },
      });

      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
      fs.unlink.mockImplementation((path, cb) => cb && cb(null));
    });

    it("still deletes the temp file when the import service throws", async () => {
      const fs = require("fs");
      req.file = { path: "temp-path/bad.csv" };
      calibrationDevicesService.bulkImportCalibrationDevices.mockRejectedValue(
        Object.assign(new Error("Malformed CSV"), { status: 422 }),
      );

      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);

      expect(fs.unlink).toHaveBeenCalledWith("temp-path/bad.csv", expect.any(Function));
      expect(error.mock.calls[0][1]).toBe("Malformed CSV");
      expect(error.mock.calls[0][2]).toBe(422);
    });
  });
});
