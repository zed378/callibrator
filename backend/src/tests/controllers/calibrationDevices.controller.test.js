/**
 * Tests for Calibration Devices Controller
 */

jest.mock("../../services/calibrationDevices.service", () => ({
  fetchCalibrationDevices: jest.fn(),
  fetchSpecificCalibrationDevice: jest.fn(),
  createCalibrationDevice: jest.fn(),
  updateCalibrationDevice: jest.fn(),
  deleteCalibrationDevice: jest.fn(),
  restoreCalibrationDevice: jest.fn(),
  bulkImportCalibrationDevices: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

// A-42: the temp-file cleanup failure is logged through winston, not console.
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("fs", () => ({
  unlink: jest.fn((path, cb) => cb && cb(null)),
}));

// The validator module is NOT mocked: every call goes through the real Zod
// schemas, so the device id below is a real uuid and parsed values are asserted.
const DEVICE_ID = "5a0e8400-e29b-41d4-a716-446655440060";

const calibrationDevicesController = require("../../controllers/calibrationDevices.controller");
const calibrationDevicesService = require("../../services/calibrationDevices.service");
const { success, error } = require("../../utils/response.util");
const { logger } = require("../../middlewares/activityLog.middleware");

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
]);

describe("calibrationDevicesController", () => {
  let req;
  let res;
  // A-133: the actor the service writes into the device's audit row.
  // A-282 (ADR-100): auditPrincipal(req).
  const ACTOR = { userId: "user-1", apiKeyId: null, ipAddress: null, userAgent: null };

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
        expect.objectContaining({ tenantId: "tenant-1", page: 1, limit: 20 }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should call error response when validation fails", async () => {
      req.query = { limit: "500" };

      await calibrationDevicesController.getAllCalibrationDevices(req, res);

      expect(calibrationDevicesService.fetchCalibrationDevices).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });

  describe("getSpecificCalibrationDevice", () => {
    it("should fetch device successfully", async () => {
      req.params = { calibrationDeviceId: DEVICE_ID };
      calibrationDevicesService.fetchSpecificCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "dev-1" },
      });

      await calibrationDevicesController.getSpecificCalibrationDevice(req, res);

      // P21-02a: the reader's id (its own open IPM draft per device) is passed too.
      expect(calibrationDevicesService.fetchSpecificCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        DEVICE_ID,
        expect.anything(),
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
        { name: "New Device", status: "active" },
        ACTOR,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createCalibrationDevice — refusals", () => {
    it("answers 400 and creates nothing for a one-character name", async () => {
      req.body = { name: "X" };

      await calibrationDevicesController.createCalibrationDevice(req, res);

      expect(calibrationDevicesService.createCalibrationDevice).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });

  describe("updateCalibrationDevice", () => {
    it("should update device successfully", async () => {
      req.params = { calibrationDeviceId: DEVICE_ID };
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
        DEVICE_ID,
        { name: "Updated Device" },
        ACTOR,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteCalibrationDevice", () => {
    it("should delete device successfully", async () => {
      req.params = { calibrationDeviceId: DEVICE_ID };
      calibrationDevicesService.deleteCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: null,
      });

      await calibrationDevicesController.deleteCalibrationDevice(req, res);

      expect(calibrationDevicesService.deleteCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        DEVICE_ID,
        ACTOR,
      );
      expect(success).toHaveBeenCalled();
    });
  });

  // A-133: restore resolves the tenant from the request context first.
  describe("restoreCalibrationDevice", () => {
    it("restores in the context tenant, with the actor", async () => {
      req.tenantId = "tenant-ctx";
      req.params = { calibrationDeviceId: DEVICE_ID };
      calibrationDevicesService.restoreCalibrationDevice.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Restored",
        data: { id: DEVICE_ID },
      });

      await calibrationDevicesController.restoreCalibrationDevice(req, res);

      expect(calibrationDevicesService.restoreCalibrationDevice).toHaveBeenCalledWith(
        "tenant-ctx",
        DEVICE_ID,
        ACTOR,
      );
      expect(success).toHaveBeenCalledWith(res, { id: DEVICE_ID }, null, "Restored", 200);
    });

    it("answers 409 through the error path for a device that is not deleted", async () => {
      req.params = { calibrationDeviceId: DEVICE_ID };
      calibrationDevicesService.restoreCalibrationDevice.mockResolvedValueOnce({
        success: false,
        status: 409,
        message: "This device is not deleted",
      });

      await calibrationDevicesController.restoreCalibrationDevice(req, res);

      expect(calibrationDevicesService.restoreCalibrationDevice).toHaveBeenCalledWith(
        "tenant-1",
        DEVICE_ID,
        ACTOR,
      );
      expect(error).toHaveBeenCalled();
      expect(error.mock.calls[0][2]).toBe(409);
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
        ACTOR,
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
      const consoleSpy = logger.error;
      fs.unlink.mockImplementation((path, cb) => cb({ code: "EACCES", message: "denied" }));
      req.file = { path: "temp-path/import.csv" };
      calibrationDevicesService.bulkImportCalibrationDevices.mockResolvedValue({
        success: true, status: 200, message: "Success", data: { successCount: 1, failedCount: 0 },
      });

      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);

      expect(consoleSpy).toHaveBeenCalledWith("Failed to delete temp import file", {
        path: "temp-path/import.csv",
        code: "EACCES",
        error: "denied",
      });
      expect(success).toHaveBeenCalled();
      fs.unlink.mockImplementation((path, cb) => cb && cb(null));
    });

    it("stays silent when the temp file is already gone (ENOENT)", async () => {
      const fs = require("fs");
      const consoleSpy = logger.error;
      fs.unlink.mockImplementation((path, cb) => cb({ code: "ENOENT" }));
      req.file = { path: "temp-path/import.csv" };
      calibrationDevicesService.bulkImportCalibrationDevices.mockResolvedValue({
        success: true, status: 200, message: "Success", data: { successCount: 1, failedCount: 0 },
      });

      await calibrationDevicesController.bulkImportCalibrationDevices(req, res);

      expect(consoleSpy).not.toHaveBeenCalled();
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
