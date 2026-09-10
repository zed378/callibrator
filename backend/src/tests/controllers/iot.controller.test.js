/**
 * Tests for iot.controller.js — ingestHttp
 *
 * iot.controller does NOT use asyncHandler. It uses its own try/catch
 * and calls next(err) on failure, so the `next` mock is the error
 * channel (success path returns directly via res).
 */

jest.mock("../../services/iot.service", () => ({
  ingestReading: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../models", () => {
  const mockFindOne = jest.fn();
  const mockUnscoped = jest.fn(() => ({ findOne: mockFindOne }));
  return {
    CalibrationDevice: {
      unscoped: mockUnscoped,
    },
    _mocks: { mockFindOne, mockUnscoped },
  };
});

const { CalibrationDevice, _mocks } = require("../../models");
const iotService = require("../../services/iot.service");
const iotController = require("../../controllers/iot.controller");
const { success } = require("../../utils/response.util");
const { AppError } = require("../../utils/appError.util");

const DEVICE_TOKEN = "iot-token-abc123";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("iotController", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    _mocks.mockFindOne.mockReset();
    success.mockImplementation(
      (res, data = null, metaOrMessage = null, messageOrStatusCode = null, statusCode = 200) => {
        let message = "success";
        let status = 200;
        if (typeof metaOrMessage === "string") {
          message = metaOrMessage;
          status = typeof messageOrStatusCode === "number" ? messageOrStatusCode : statusCode;
        } else {
          message = typeof messageOrStatusCode === "string" ? messageOrStatusCode : "success";
          status = statusCode;
        }
        res.status(status).json({ success: true, status, message, data });
      },
    );
    req = {
      headers: {},
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("ingestHttp", () => {
    it("should ingest a reading with valid token and payload", async () => {
      _mocks.mockFindOne.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: TENANT_ID,
      });

      iotService.ingestReading.mockResolvedValue({ success: true, isAnomaly: false });

      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {
        payload: { temperature: 22.5, humidity: 60 },
      };

      await iotController.ingestHttp(req, res, next);

      expect(iotService.ingestReading).toHaveBeenCalledWith(TENANT_ID, DEVICE_ID, {
        temperature: 22.5,
        humidity: 60,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("should accept token from request body instead of header", async () => {
      _mocks.mockFindOne.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: TENANT_ID,
      });

      iotService.ingestReading.mockResolvedValue({ success: true, isAnomaly: false });

      req.headers = {};
      req.body = {
        token: DEVICE_TOKEN,
        payload: { temperature: 22.5 },
      };

      await iotController.ingestHttp(req, res, next);

      expect(iotService.ingestReading).toHaveBeenCalledWith(TENANT_ID, DEVICE_ID, {
        temperature: 22.5,
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 401 when token is missing", async () => {
      req.headers = {};
      req.body = {
        payload: { temperature: 22.5 },
      };

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
      expect(next.mock.calls[0][0].status).toBe(401);
      expect(next.mock.calls[0][0].message).toBe("IoT Device Token is required");
    });

    it("should return 400 when payload is missing", async () => {
      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {};

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
      expect(next.mock.calls[0][0].message).toBe("Payload object is required");
    });

    it("should return 401 when device token is invalid", async () => {
      _mocks.mockFindOne.mockResolvedValue(null);

      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {
        payload: { temperature: 22.5 },
      };

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(401);
      expect(next.mock.calls[0][0].message).toBe("Invalid IoT Device Token or IoT is disabled for this device");
    });

    it("should return 400 when payload is not an object", async () => {
      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {
        payload: "not-an-object",
      };

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(400);
      expect(next.mock.calls[0][0].message).toBe("Payload object is required");
    });

    it("should handle service error via next", async () => {
      _mocks.mockFindOne.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: TENANT_ID,
      });

      iotService.ingestReading.mockRejectedValue(new Error("Database error"));

      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {
        payload: { temperature: 22.5 },
      };

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
