/**
 * Tests for Calibration Records Controller
 */

jest.mock("../../services/calibrationRecords.service", () => ({
  fetchCalibrationRecords: jest.fn(),
  fetchSpecificCalibrationRecord: jest.fn(),
  createCalibrationRecord: jest.fn(),
  updateCalibrationRecord: jest.fn(),
  deleteCalibrationRecord: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../validators/calibrationRecords.validator", () => {
  const Joi = require("joi");
  return {
    getCalibrationRecordsQuery: Joi.object(),
    calibrationRecordIdSchema: Joi.object(),
    createCalibrationRecordSchema: Joi.object(),
    updateCalibrationRecordSchema: Joi.object(),
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

const calibrationRecordsController = require("../../controllers/calibrationRecords.controller");
const calibrationRecordsService = require("../../services/calibrationRecords.service");
const { success, error } = require("../../utils/response.util");

describe("calibrationRecordsController", () => {
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

  describe("getAllCalibrationRecords", () => {
    it("should fetch all records successfully", async () => {
      calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { rows: [{ id: "rec-1" }], meta: { total: 1 } },
      });

      await calibrationRecordsController.getAllCalibrationRecords(req, res);

      expect(calibrationRecordsService.fetchCalibrationRecords).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1" }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should call error response when validation fails", async () => {
      req.query = { failValidation: true };

      await calibrationRecordsController.getAllCalibrationRecords(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getSpecificCalibrationRecord", () => {
    it("should fetch specific record successfully", async () => {
      req.params = { calibrationRecordId: "rec-1" };
      calibrationRecordsService.fetchSpecificCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "rec-1" },
      });

      await calibrationRecordsController.getSpecificCalibrationRecord(req, res);

      expect(calibrationRecordsService.fetchSpecificCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        "rec-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createCalibrationRecord", () => {
    it("should create record successfully", async () => {
      req.body = { notes: "Created record" };
      calibrationRecordsService.createCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Success",
        data: { id: "rec-1" },
      });

      await calibrationRecordsController.createCalibrationRecord(req, res);

      expect(calibrationRecordsService.createCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        "user-1",
        { notes: "Created record" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateCalibrationRecord", () => {
    it("should update record successfully", async () => {
      req.params = { calibrationRecordId: "rec-1" };
      req.body = { notes: "Updated record" };
      calibrationRecordsService.updateCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "rec-1" },
      });

      await calibrationRecordsController.updateCalibrationRecord(req, res);

      expect(calibrationRecordsService.updateCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        "rec-1",
        { notes: "Updated record" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteCalibrationRecord", () => {
    it("should delete record successfully", async () => {
      req.params = { calibrationRecordId: "rec-1" };
      calibrationRecordsService.deleteCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: null,
      });

      await calibrationRecordsController.deleteCalibrationRecord(req, res);

      expect(calibrationRecordsService.deleteCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        "rec-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });
});
