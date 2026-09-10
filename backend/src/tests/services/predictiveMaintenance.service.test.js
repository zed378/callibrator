// eslint-disable-next-line no-undef
jest.mock("../../models", () => ({
  CalibrationDevice: {
    findOne: jest.fn(),
  },
  IotReading: {
    count: jest.fn(),
  },
  Notification: {
    create: jest.fn(),
  },
}));
jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const { Op } = require("sequelize");
const predictiveMaintenanceService = require("../../services/predictiveMaintenance.service");

describe("predictiveMaintenance.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("analyzeDevice", () => {
    it("should throw error when device not found", async () => {
      const { CalibrationDevice } = require("../../models");
      CalibrationDevice.findOne.mockResolvedValue(null);

      await expect(
        predictiveMaintenanceService.analyzeDevice("tenant-1", "device-1"),
      ).rejects.toThrow("IoT enabled Calibration Device not found");
    });

    it("should throw error when device has no baseline interval", async () => {
      const { CalibrationDevice } = require("../../models");
      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: null,
      });

      await expect(
        predictiveMaintenanceService.analyzeDevice("tenant-1", "device-1"),
      ).rejects.toThrow(
        "Device has no baseline calibration interval to optimize",
      );
    });

    it("should skip when not enough IoT readings", async () => {
      const { CalibrationDevice, IotReading } = require("../../models");
      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
      });
      IotReading.count.mockResolvedValue(5);

      const result = await predictiveMaintenanceService.analyzeDevice(
        "tenant-1",
        "device-1",
      );

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe(
        "Not enough IoT readings in the last 30 days.",
      );
    });

    it("should shorten interval by 50% when anomaly rate > 5%", async () => {
      const {
        CalibrationDevice,
        IotReading,
        Notification,
      } = require("../../models");
      const { logger } = require("../../middlewares/activityLog.middleware");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count
        .mockResolvedValueOnce(100) // total readings
        .mockResolvedValueOnce(8); // anomaly readings (8%)

      const result = await predictiveMaintenanceService.analyzeDevice(
        "tenant-1",
        "device-1",
      );

      expect(result.status).toBe("recommended");
      expect(result.newInterval).toBe(15); // 30 * 0.5 = 15
      expect(result.reason).toContain("High anomaly rate");
      expect(Notification.create).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it("should shorten interval by 20% when anomaly rate is 1-5%", async () => {
      const {
        CalibrationDevice,
        IotReading,
        Notification,
      } = require("../../models");
      const { logger } = require("../../middlewares/activityLog.middleware");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count
        .mockResolvedValueOnce(100) // total readings
        .mockResolvedValueOnce(3); // anomaly readings (3%)

      const result = await predictiveMaintenanceService.analyzeDevice(
        "tenant-1",
        "device-1",
      );

      expect(result.status).toBe("recommended");
      expect(result.newInterval).toBe(24); // 30 * 0.8 = 24
      expect(result.reason).toContain("Moderate anomaly rate");
      expect(Notification.create).toHaveBeenCalled();
    });

    it("should extend interval by 20% when zero anomalies and large sample", async () => {
      const {
        CalibrationDevice,
        IotReading,
        Notification,
      } = require("../../models");
      const { logger } = require("../../middlewares/activityLog.middleware");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count
        .mockResolvedValueOnce(200) // total readings (> 100)
        .mockResolvedValueOnce(0); // zero anomalies

      const result = await predictiveMaintenanceService.analyzeDevice(
        "tenant-1",
        "device-1",
      );

      expect(result.status).toBe("recommended");
      expect(result.newInterval).toBe(36); // 30 * 1.2 = 36
      expect(result.reason).toContain("Zero anomalies detected");
      expect(Notification.create).toHaveBeenCalled();
    });

    it("should return unchanged when stable with no change needed", async () => {
      const { CalibrationDevice, IotReading } = require("../../models");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count
        .mockResolvedValueOnce(50) // total readings
        .mockResolvedValueOnce(0); // 0% anomaly rate

      const result = await predictiveMaintenanceService.analyzeDevice(
        "tenant-1",
        "device-1",
      );

      expect(result.status).toBe("unchanged");
      expect(result.reason).toBe(
        "Current calibration interval is optimal based on recent readings.",
      );
    });

    it("should respect minimum interval of 1 day when shortening", async () => {
      const {
        CalibrationDevice,
        IotReading,
        Notification,
      } = require("../../models");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 1,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count.mockResolvedValueOnce(100).mockResolvedValueOnce(10); // 10% anomaly rate

      const result = await predictiveMaintenanceService.analyzeDevice(
        "tenant-1",
        "device-1",
      );

      expect(result.newInterval).toBe(1); // Math.max(1, Math.floor(5 * 0.5)) = 1
    });

    it("should include device name in notification", async () => {
      const {
        CalibrationDevice,
        IotReading,
        Notification,
      } = require("../../models");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Pressure Sensor A",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count.mockResolvedValueOnce(200).mockResolvedValueOnce(0);

      await predictiveMaintenanceService.analyzeDevice("tenant-1", "device-1");

      expect(Notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Pressure Sensor A"),
          message: expect.stringContaining("Pressure Sensor A"),
          type: "MAINTENANCE",
        }),
      );
    });

    it("should use correct tenantId and deviceId filters for IoT readings", async () => {
      const { CalibrationDevice, IotReading } = require("../../models");

      CalibrationDevice.findOne.mockResolvedValue({
        id: "device-1",
        name: "Test Device",
        tenantId: "tenant-1",
        iotEnabled: true,
        calibrationIntervalDays: 30,
        update: jest.fn().mockResolvedValue(true),
      });
      IotReading.count.mockResolvedValueOnce(50).mockResolvedValueOnce(1);

      await predictiveMaintenanceService.analyzeDevice("tenant-1", "device-1");

      // First call is for total readings
      expect(IotReading.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deviceId: "device-1",
            tenantId: "tenant-1",
          }),
        }),
      );
    });
  });
});
