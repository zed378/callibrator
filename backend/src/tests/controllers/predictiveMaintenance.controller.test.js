jest.mock("../../services/predictiveMaintenance.service", () => ({
  analyzeDevice: jest.fn(),
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

  describe("approveRecommendation", () => {
    it("should approve recommendation", async () => {
      req.params = { deviceId: "device-1" };
      const mockDevice = {
        id: "device-1",
        recommendedCalibrationInterval: 30,
        calibrationIntervalDays: 60,
        update: jest.fn().mockResolvedValue({}),
      };
      CalibrationDevice.findOne.mockResolvedValue(mockDevice);
      await predictiveMaintenanceController.approveRecommendation(req, res, next);
      expect(res.json).toHaveBeenCalled();
      expect(mockDevice.update).toHaveBeenCalled();
    });

    it("should handle device not found", async () => {
      req.params = { deviceId: "device-999" };
      CalibrationDevice.findOne.mockResolvedValue(null);
      await predictiveMaintenanceController.approveRecommendation(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should handle no recommendation", async () => {
      req.params = { deviceId: "device-1" };
      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        recommendedCalibrationInterval: null,
        update: jest.fn().mockResolvedValue({}),
      });
      await predictiveMaintenanceController.approveRecommendation(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      req.params = { deviceId: "device-1" };
      CalibrationDevice.findOne.mockRejectedValue(new Error("err"));
      await predictiveMaintenanceController.approveRecommendation(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});