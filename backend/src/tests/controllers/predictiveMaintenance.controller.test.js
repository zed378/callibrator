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

// Mirrors the REAL success(res, data, meta, message, statusCode), which SENDS
// the response. The previous mock invented a (message, data) body-builder
// signature that response.util does not have — which is exactly why
// `res.status(200).json(success("msg", data))` looked fine here while throwing
// "res.status is not a function" in production.
jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data = null, metaOrMessage = null, messageOrStatusCode = null, statusCode = 200) => {
    const message =
      typeof metaOrMessage === "string" ? metaOrMessage : messageOrStatusCode;
    const status =
      typeof metaOrMessage === "string" && typeof messageOrStatusCode === "number"
        ? messageOrStatusCode
        : statusCode;
    return res.status(status).json({ success: true, status, message, data });
  }),
}));

const predictiveMaintenanceController = require("../../controllers/predictiveMaintenance.controller");
const predictiveMaintenanceService = require("../../services/predictiveMaintenance.service");
const { CalibrationDevice } = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

describe("predictiveMaintenance Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    tenantStorage.getStore.mockReturnValue({ tenantId: "tenant-1" });
    req = { params: {}, body: {}, query: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
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
      const { Op } = require("sequelize");
      CalibrationDevice.findAll.mockResolvedValue([]);

      await predictiveMaintenanceController.getRecommendations(req, res, next);

      const where = CalibrationDevice.findAll.mock.calls[0][0].where;
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
