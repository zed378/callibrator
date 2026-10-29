jest.mock("../../services/predictiveMaintenance.service", () => ({
  analyzeDevice: jest.fn(),
  approveRecommendation: jest.fn(),
}));

jest.mock("../../models", () => ({
  CalibrationDevice: {
    findAll: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantStorage: { getStore: jest.fn() },
}));

interface FakeRes {
  status: jest.Mock<FakeRes, [number]>;
  json: jest.Mock;
}

// Mirrors the REAL success(res, data, meta, message, statusCode), which SENDS
// the response. The previous mock invented a (message, data) body-builder
// signature that response.util does not have — which is exactly why
// `res.status(200).json(success("msg", data))` looked fine here while throwing
// "res.status is not a function" in production.
jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res: FakeRes, data: unknown = null) => {
    res.status(200);
    res.json({ success: true, message: "Recommendation applied successfully", data });
    return res;
  }),
}));

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

type Handler = (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<unknown>;

interface PredictiveMaintenanceControllerDouble {
  analyzeDevice: Handler;
  getRecommendations: Handler;
  approveRecommendation: Handler;
}

interface PredictiveMaintenanceServiceDouble {
  analyzeDevice: jest.Mock;
  approveRecommendation: jest.Mock;
}

interface FindAllOptions {
  where: {
    tenantId?: string;
    recommendedCalibrationInterval: Record<symbol | string, unknown>;
  };
}

interface ModelsDouble {
  CalibrationDevice: {
    findAll: jest.Mock<Promise<unknown>, [FindAllOptions]>;
    findOne: jest.Mock;
  };
}

interface TenantContextDouble {
  tenantStorage: {
    getStore: jest.Mock;
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const predictiveMaintenanceController = require("../../controllers/predictiveMaintenance.controller") as PredictiveMaintenanceControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const predictiveMaintenanceService = require("../../services/predictiveMaintenance.service") as PredictiveMaintenanceServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { CalibrationDevice } = require("../../models") as ModelsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as TenantContextDouble;

describe("predictiveMaintenance Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    tenantStorage.getStore.mockReturnValue({ tenantId: "tenant-1" });
    req = { params: {}, body: {}, query: {} };
    const mockRes: FakeRes = {
      status: jest.fn<FakeRes, [number]>(),
      json: jest.fn(),
    };
    mockRes.status.mockReturnValue(mockRes);
    mockRes.json.mockReturnValue(mockRes);
    res = mockRes;
    next = jest.fn();
  });

  describe("analyzeDevice", () => {
    it("should analyze device", async () => {
      req.params = { deviceId: "device-1" };
      predictiveMaintenanceService.analyzeDevice.mockResolvedValue({ recommendation: "calibrate" });
      await predictiveMaintenanceController.analyzeDevice(req, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      req.params = { deviceId: "device-1" };
      predictiveMaintenanceService.analyzeDevice.mockRejectedValue(new Error("err"));
      await predictiveMaintenanceController.analyzeDevice(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("getRecommendations", () => {
    it("should return recommendations", async () => {
      CalibrationDevice.findAll.mockResolvedValue([]);
      await predictiveMaintenanceController.getRecommendations(req, res, next);
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("should filter on a real Sequelize operator, not the Mongo-style $ne", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- inline require for Sequelize Op
      const { Op } = require("sequelize") as { Op: { ne: symbol } };
      CalibrationDevice.findAll.mockResolvedValue([]);

      await predictiveMaintenanceController.getRecommendations(req, res, next);

      const firstCall = (CalibrationDevice.findAll.mock.calls as [{ where: Record<string, unknown> }][])[0];
      if (!firstCall) {
        throw new Error("findAll was not called");
      }
      const where = firstCall[0].where as { recommendedCalibrationInterval: Record<string | symbol, unknown>; tenantId: string };
      const filter = where.recommendedCalibrationInterval;
      // `{ $ne: null }` was compared as a literal and 500'd with
      // "invalid input syntax for type integer".
      expect(filter).not.toHaveProperty("$ne");
      expect(filter[Op.ne]).toBeNull();
      expect(where.tenantId).toBe("tenant-1");
    });

    it("should handle errors", async () => {
      CalibrationDevice.findAll.mockRejectedValue(new Error("err"));
      await predictiveMaintenanceController.getRecommendations(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // A-145 — the lookup, the 404/409 and the audited update live in the
  // service (tests/services/predictiveMaintenance.service.test.js); the
  // controller passes the tenant, the device and the approving user.
  describe("approveRecommendation", () => {
    it("applies the recommendation as the calling user", async () => {
      req.params = { deviceId: "device-1" };
      req.user = { id: "user-7" };
      const device = { id: "device-1", calibrationIntervalDays: 30 };
      predictiveMaintenanceService.approveRecommendation.mockResolvedValue(device);
      await predictiveMaintenanceController.approveRecommendation(req, res, next);
      expect(predictiveMaintenanceService.approveRecommendation).toHaveBeenCalledWith(
        "tenant-1",
        "device-1",
        "user-7",
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: device, message: "Recommendation applied successfully" }),
      );
    });

    it("passes a service error on", async () => {
      req.params = { deviceId: "device-1" };
      req.user = { id: "user-7" };
      const err = new Error("err");
      predictiveMaintenanceService.approveRecommendation.mockRejectedValue(err);
      await predictiveMaintenanceController.approveRecommendation(req, res, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
