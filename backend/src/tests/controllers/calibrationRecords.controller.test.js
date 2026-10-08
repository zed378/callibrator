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

// The validator module is NOT mocked: every call goes through the real Zod
// schemas, so the ids below are real uuids and the parsed values are asserted.
const REC_ID = "5a0e8400-e29b-41d4-a716-446655440010";
const DEVICE_ID = "5a0e8400-e29b-41d4-a716-446655440020";

const calibrationRecordsController = require("../../controllers/calibrationRecords.controller");
const calibrationRecordsService = require("../../services/calibrationRecords.service");
const { success, error, sendResult } = require("../../utils/response.util");

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
]);

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

      expect(calibrationRecordsService.fetchCalibrationRecords).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        page: 1,
        limit: 20,
        deviceId: undefined,
        isCompliant: undefined,
        from: undefined,
        to: undefined,
        includeSuperseded: false,
      });
      // P21-09e (spec § 12): each row carries its performer's display (none here: no person id).
      expect(success).toHaveBeenCalledWith(res, [{ id: "rec-1", performerDisplay: null }], { total: 1 }, "Success", 200);
    });

    it("converts query strings the way the schema names them", async () => {
      req.query = { page: "2", limit: "5", deviceId: DEVICE_ID, isCompliant: "true", includeSuperseded: "true" };
      calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { rows: [], meta: { total: 0 } },
      });

      await calibrationRecordsController.getAllCalibrationRecords(req, res);

      expect(calibrationRecordsService.fetchCalibrationRecords).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        page: 2,
        limit: 5,
        deviceId: DEVICE_ID,
        isCompliant: true,
        from: undefined,
        to: undefined,
        includeSuperseded: true,
      });
    });

    it("should call error response when validation fails", async () => {
      req.query = { page: "0" };

      await calibrationRecordsController.getAllCalibrationRecords(req, res);

      expect(calibrationRecordsService.fetchCalibrationRecords).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });

    it("sends a failed result down the error path with no rows or meta", async () => {
      calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce({
        success: false,
        status: 403,
        message: "Forbidden",
      });

      await calibrationRecordsController.getAllCalibrationRecords(req, res);

      expect(error).toHaveBeenCalledWith(res, "Forbidden", 403);
    });
  });

  describe("getSpecificCalibrationRecord", () => {
    it("should fetch specific record successfully", async () => {
      req.params = { calibrationRecordId: REC_ID };
      calibrationRecordsService.fetchSpecificCalibrationRecord.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { id: "rec-1" },
      });

      await calibrationRecordsController.getSpecificCalibrationRecord(req, res);

      expect(calibrationRecordsService.fetchSpecificCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        REC_ID,
      );
      expect(success).toHaveBeenCalled();
    });

    it("answers 400 for a record id that is not a uuid, and fetches nothing", async () => {
      req.params = { calibrationRecordId: "rec-1" };

      await calibrationRecordsController.getSpecificCalibrationRecord(req, res);

      expect(calibrationRecordsService.fetchSpecificCalibrationRecord).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });

  describe("createCalibrationRecord", () => {
    it("should create record successfully", async () => {
      req.body = { deviceId: DEVICE_ID, calibrationDate: "2026-09-01", notes: "Created record" };
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
        { deviceId: DEVICE_ID, calibrationDate: new Date("2026-09-01"), notes: "Created record" },
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  // P6-03 — correct and void replace update and delete.
  describe("correctCalibrationRecord", () => {
    it("passes the tenant, the ACTING user, the record and the body to the service", async () => {
      req.params = { calibrationRecordId: REC_ID };
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
        REC_ID,
        { notes: "Corrected", reason: "misread" },
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("voidCalibrationRecord", () => {
    it("passes the tenant, the acting user, the record and the reason to the service", async () => {
      req.params = { calibrationRecordId: REC_ID };
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
        REC_ID,
        { reason: "entered twice" },
        { userId: "user-1", apiKeyId: null, ipAddress: "10.0.0.9", userAgent: "jest-agent" },
      );
      expect(success).toHaveBeenCalled();
    });

    it("answers 400 for a blank reason, and voids nothing", async () => {
      req.params = { calibrationRecordId: REC_ID };
      req.body = { reason: "   " };

      await calibrationRecordsController.voidCalibrationRecord(req, res);

      expect(calibrationRecordsService.voidCalibrationRecord).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });
});
