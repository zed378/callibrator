/**
 * Tests for iot.controller.ts — ingestHttp
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

interface FakeReq {
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
}

interface NextError {
  status?: number;
  message?: string;
}

type NextMock = jest.Mock<unknown, [NextError]>;

interface ModelsDouble {
  _mocks: {
    mockFindOne: jest.Mock;
    mockUnscoped: jest.Mock;
  };
}

interface IotControllerDouble {
  ingestHttp: (req: FakeReq, res: FakeRes, next: NextMock) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { _mocks } = require("../../models") as ModelsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const iotService = require("../../services/iot.service") as { ingestReading: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const iotController = require("../../controllers/iot.controller") as IotControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as { success: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { AppError } = require("../../utils/appError.util") as { AppError: unknown };

const DEVICE_TOKEN = "iot-token-abc123";
const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("iotController", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: NextMock;

  beforeEach(() => {
    jest.clearAllMocks();
    _mocks.mockFindOne.mockReset();
    success.mockImplementation(
      (
        resArg: FakeRes,
        data: unknown = null,
        metaOrMessage: unknown = null,
        messageOrStatusCode: unknown = null,
        statusCode: number | undefined = 200,
      ) => {
        let message = "success";
        let status = 200;
        if (typeof metaOrMessage === "string") {
          message = metaOrMessage;
          status = typeof messageOrStatusCode === "number" ? messageOrStatusCode : statusCode;
        } else {
          message = typeof messageOrStatusCode === "string" ? messageOrStatusCode : "success";
          status = statusCode;
        }
        resArg.status(status);
        resArg.json({ success: true, status, message, data });
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
    next = jest.fn<unknown, [NextError]>();
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
      const err0 = next.mock.calls[0]?.[0] as { status?: number; message?: string } | undefined;
      expect(err0).toBeInstanceOf(AppError);
      expect(err0?.status).toBe(401);
      expect(err0?.message).toBe("IoT Device Token is required");
    });

    it("should return 400 when payload is missing", async () => {
      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {};

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      const err1 = next.mock.calls[0]?.[0] as { status?: number; message?: string } | undefined;
      expect(err1?.status).toBe(400);
      expect(err1?.message).toBe("Payload object is required");
    });

    it("should return 401 when device token is invalid", async () => {
      _mocks.mockFindOne.mockResolvedValue(null);

      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {
        payload: { temperature: 22.5 },
      };

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      const err2 = next.mock.calls[0]?.[0] as { status?: number; message?: string } | undefined;
      expect(err2?.status).toBe(401);
      expect(err2?.message).toBe("Invalid IoT Device Token or IoT is disabled for this device");
    });

    it("should return 400 when payload is not an object", async () => {
      req.headers["x-iot-token"] = DEVICE_TOKEN;
      req.body = {
        payload: "not-an-object",
      };

      await iotController.ingestHttp(req, res, next);

      expect(next).toHaveBeenCalled();
      const err3 = next.mock.calls[0]?.[0] as { status?: number; message?: string } | undefined;
      expect(err3?.status).toBe(400);
      expect(err3?.message).toBe("Payload object is required");
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
