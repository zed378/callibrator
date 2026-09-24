/**
 * Tests for Calibration Records Controller
 */

jest.mock("../../services/calibrationRecords.service", () => ({
  fetchCalibrationRecords: jest.fn(),
  fetchSpecificCalibrationRecord: jest.fn(),
  createCalibrationRecord: jest.fn(),
  correctCalibrationRecord: jest.fn(),
  voidCalibrationRecord: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
  sendResult: jest.fn(),
}));

jest.mock("../../validators/calibrationRecords.validator", () => {
  const Joi = require("joi");
  return {
    getCalibrationRecordsQuery: Joi.object(),
    calibrationRecordIdSchema: Joi.object(),
    createCalibrationRecordSchema: Joi.object(),
    correctCalibrationRecordSchema: Joi.object(),
    voidCalibrationRecordSchema: Joi.object(),
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
const { success, error, sendResult } = require("../../utils/response.util");

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
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.9",
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
    // A-112: the real routing rule is pinned against the real response.util in
    // envelope.a112.test.js; here it routes onto the doubles above so these
    // tests can keep asserting on success/error.
    sendResult.mockImplementation((response, result, meta = null) =>
      result.status >= 400 || result.success === false
        ? error(response, result.message || "Request failed", result.status >= 400 ? result.status : 500)
        : success(response, result.data, meta, result.message, result.status),
    );
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
        { userId: "user-1", tenantId: "tenant-1", ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  // P6-03 — correct and void replace update and delete.
  describe("correctCalibrationRecord", () => {
    it("passes the tenant, the ACTING user, the record and the body to the service", async () => {
      req.params = { calibrationRecordId: "rec-1" };
      req.body = { notes: "Corrected", reason: "misread" };
      calibrationRecordsService.correctCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Success",
        data: { id: "rec-2" },
      });

      await calibrationRecordsController.correctCalibrationRecord(req, res);

      expect(calibrationRecordsService.correctCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        "user-1",
        "rec-1",
        { notes: "Corrected", reason: "misread" },
        { userId: "user-1", tenantId: "tenant-1", ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("voidCalibrationRecord", () => {
    it("passes the tenant, the acting user, the record and the reason to the service", async () => {
      req.params = { calibrationRecordId: "rec-1" };
      req.body = { reason: "entered twice" };
      calibrationRecordsService.voidCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: null,
      });

      await calibrationRecordsController.voidCalibrationRecord(req, res);

      expect(calibrationRecordsService.voidCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        "user-1",
        "rec-1",
        { reason: "entered twice" },
        { userId: "user-1", tenantId: "tenant-1", ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });
});
