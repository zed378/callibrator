/**
 * Tests for Calibration Records Controller
 */
import type { Request, Response } from "express";

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

interface CalibrationRecordsServiceDouble {
  fetchCalibrationRecords: jest.Mock;
  fetchSpecificCalibrationRecord: jest.Mock;
  createCalibrationRecord: jest.Mock;
  correctCalibrationRecord: jest.Mock;
  voidCalibrationRecord: jest.Mock;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

interface CalibrationRecordsControllerDouble {
  getAllCalibrationRecords: Handler;
  getSpecificCalibrationRecord: Handler;
  createCalibrationRecord: Handler;
  correctCalibrationRecord: Handler;
  voidCalibrationRecord: Handler;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
  sendResult: jest.Mock;
}

interface ServiceResult {
  success?: boolean;
  status: number;
  message?: string;
  data?: unknown;
}

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: (code: number) => FakeRes;
  json: jest.Mock;
  locals: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const calibrationRecordsController = require("../../controllers/calibrationRecords.controller") as CalibrationRecordsControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const calibrationRecordsService = require("../../services/calibrationRecords.service") as CalibrationRecordsServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success, error, sendResult } = require("../../utils/response.util") as ResponseDouble;

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS: unknown = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String) as unknown, message: expect.any(String) as unknown }),
]);

describe("calibrationRecordsController", () => {
  let req: FakeReq;
  let res: FakeRes;

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

    success.mockImplementation(
      (response: FakeRes, data: unknown, meta: unknown, message: string, status?: number) => {
        response.status(status ?? 200).json({ success: true, data, meta, message });
      },
    );
    error.mockImplementation((response: FakeRes, message: string, status?: number) => {
      response.status(status ?? 500).json({ success: false, message });
    });
    // A-112: the real routing rule is pinned against the real response.util in
    // envelope.a112.test.js; here it routes onto the doubles above so these
    // tests can keep asserting on success/error.
    sendResult.mockImplementation((response: FakeRes, result: ServiceResult, meta: unknown = null) => {
      if (result.status >= 400 || result.success === false) {
        error(response, result.message ?? "Request failed", result.status >= 400 ? result.status : 500);
      } else {
        success(response, result.data, meta, result.message, result.status);
      }
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

      await calibrationRecordsController.getAllCalibrationRecords(req as unknown as Request, res as unknown as Response);

      expect(calibrationRecordsService.fetchCalibrationRecords).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        page: 1,
        limit: 20,
        deviceId: undefined,
        isCompliant: undefined,
        from: undefined,
        to: undefined,
        includeSuperseded: false,
        // P21-06 (spec P19-05 § 8): the recap parameters, passed on (their defaults here).
        dateField: "calibration",
        fromDay: undefined,
        toDay: undefined,
        latestOnly: false,
        entryKind: undefined,
        clientFacilityId: undefined,
        qrCode: undefined,
        sort: undefined,
      });
      // P21-09e (spec § 12): each row carries its performer's display (none here: no person id).
      // P21-06: and its recap facts (the room snapshot, `effective`, the facility for provider staff).
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: "rec-1", performerDisplay: null, room: { name: "—", floor: "—" }, effective: true, clientFacility: null }],
        { total: 1 },
        "Success",
        200,
      );
    });

    it("converts query strings the way the schema names them", async () => {
      req.query = { page: "2", limit: "5", deviceId: DEVICE_ID, isCompliant: "true", includeSuperseded: "true" };
      calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Success",
        data: { rows: [], meta: { total: 0 } },
      });

      await calibrationRecordsController.getAllCalibrationRecords(req as unknown as Request, res as unknown as Response);

      expect(calibrationRecordsService.fetchCalibrationRecords).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        page: 2,
        limit: 5,
        deviceId: DEVICE_ID,
        isCompliant: true,
        from: undefined,
        to: undefined,
        includeSuperseded: true,
        // P21-06 (spec P19-05 § 8): the recap parameters, passed on (their defaults here).
        dateField: "calibration",
        fromDay: undefined,
        toDay: undefined,
        latestOnly: false,
        entryKind: undefined,
        clientFacilityId: undefined,
        qrCode: undefined,
        sort: undefined,
      });
    });

    it("should call error response when validation fails", async () => {
      req.query = { page: "0" };

      await calibrationRecordsController.getAllCalibrationRecords(req as unknown as Request, res as unknown as Response);

      expect(calibrationRecordsService.fetchCalibrationRecords).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });

    it("sends a failed result down the error path with no rows or meta", async () => {
      calibrationRecordsService.fetchCalibrationRecords.mockResolvedValueOnce({
        success: false,
        status: 403,
        message: "Forbidden",
      });

      await calibrationRecordsController.getAllCalibrationRecords(req as unknown as Request, res as unknown as Response);

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

      await calibrationRecordsController.getSpecificCalibrationRecord(req as unknown as Request, res as unknown as Response);

      expect(calibrationRecordsService.fetchSpecificCalibrationRecord).toHaveBeenCalledWith(
        "tenant-1",
        REC_ID,
      );
      expect(success).toHaveBeenCalled();
    });

    it("answers 400 for a record id that is not a uuid, and fetches nothing", async () => {
      req.params = { calibrationRecordId: "rec-1" };

      await calibrationRecordsController.getSpecificCalibrationRecord(req as unknown as Request, res as unknown as Response);

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

      await calibrationRecordsController.createCalibrationRecord(req as unknown as Request, res as unknown as Response);

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

      await calibrationRecordsController.correctCalibrationRecord(req as unknown as Request, res as unknown as Response);

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

      await calibrationRecordsController.voidCalibrationRecord(req as unknown as Request, res as unknown as Response);

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

      await calibrationRecordsController.voidCalibrationRecord(req as unknown as Request, res as unknown as Response);

      expect(calibrationRecordsService.voidCalibrationRecord).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });
});
