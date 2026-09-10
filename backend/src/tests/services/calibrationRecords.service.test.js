/**
 * Tests for calibrationRecords.service.js
 */

jest.mock("sequelize", () => ({
  Op: {
    gte: Symbol("gte"),
    lte: Symbol("lte"),
  },
}));

jest.mock("../../models", () => ({
  CalibrationRecord: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  CalibrationDevice: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../validators/calibrationRecords.validator", () => ({
  createCalibrationRecordSchema: {
    validate: jest.fn(),
  },
  updateCalibrationRecordSchema: {
    validate: jest.fn(),
  },
}));

const { CalibrationRecord, CalibrationDevice } = require("../../models");
const validator = require("../../validators/calibrationRecords.validator");
const {
  fetchCalibrationRecords,
  fetchSpecificCalibrationRecord,
  createCalibrationRecord,
  updateCalibrationRecord,
  deleteCalibrationRecord,
} = require("../../services/calibrationRecords.service");

describe("calibrationRecords.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchCalibrationRecords", () => {
    it("should fetch records successfully without optional filters", async () => {
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "record-1" }],
        count: 1,
      });

      const result = await fetchCalibrationRecords({ tenantId: "tenant-1" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.rows).toHaveLength(1);
    });

    it("should fetch records with all optional filters (deviceId, isCompliant, from, to)", async () => {
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "record-1" }],
        count: 1,
      });

      const result = await fetchCalibrationRecords({
        tenantId: "tenant-1",
        deviceId: "device-1",
        isCompliant: true,
        from: "2026-01-01",
        to: "2026-06-30",
        page: 2,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(CalibrationRecord.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            deviceId: "device-1",
            isCompliant: true,
            calibrationDate: expect.any(Object),
          }),
          limit: 10,
          offset: 10,
        }),
      );
    });

    it("applies only a lower bound when `from` is given without `to`", async () => {
      const { Op } = require("sequelize");
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCalibrationRecords({ tenantId: "tenant-1", from: "2026-01-01" });

      const where = CalibrationRecord.findAndCountAll.mock.calls[0][0].where;
      expect(where.calibrationDate[Op.gte]).toBe("2026-01-01");
      expect(where.calibrationDate[Op.lte]).toBeUndefined();
    });

    it("applies only an upper bound when `to` is given without `from`", async () => {
      const { Op } = require("sequelize");
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCalibrationRecords({ tenantId: "tenant-1", to: "2026-06-30" });

      const where = CalibrationRecord.findAndCountAll.mock.calls[0][0].where;
      expect(where.calibrationDate[Op.lte]).toBe("2026-06-30");
      expect(where.calibrationDate[Op.gte]).toBeUndefined();
    });

    it("omits the calibrationDate filter entirely when neither bound is given", async () => {
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchCalibrationRecords({ tenantId: "tenant-1" });

      const where = CalibrationRecord.findAndCountAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("calibrationDate");
    });

    it("should handle error during fetching", async () => {
      CalibrationRecord.findAndCountAll.mockRejectedValueOnce(new Error("Db error"));
      await expect(
        fetchCalibrationRecords({ tenantId: "tenant-1" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("fetchSpecificCalibrationRecord", () => {
    it("should fetch specific record successfully", async () => {
      CalibrationRecord.findOne.mockResolvedValueOnce({ id: "record-1" });

      const result = await fetchSpecificCalibrationRecord("tenant-1", "record-1");

      expect(result.success).toBe(true);
      expect(result.data.id).toBe("record-1");
    });

    it("should return 404 if not found", async () => {
      CalibrationRecord.findOne.mockResolvedValueOnce(null);

      const result = await fetchSpecificCalibrationRecord("tenant-1", "record-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    });

    it("should handle error during fetchSpecific", async () => {
      CalibrationRecord.findOne.mockRejectedValueOnce(new Error("Db error"));
      await expect(
        fetchSpecificCalibrationRecord("tenant-1", "record-1"),
      ).rejects.toThrow("Db error");
    });
  });

  describe("createCalibrationRecord", () => {
    it("should throw 400 when validation fails", async () => {
      validator.createCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: { details: [{ path: ["deviceId"], message: "deviceId required" }] },
      });

      await expect(
        createCalibrationRecord("tenant-1", "user-1", {}),
      ).rejects.toEqual(
        expect.objectContaining({
          status: 400,
        }),
      );
    });

    it("should return 404 if device not found or belongs to another tenant", async () => {
      validator.createCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: { deviceId: "device-1" },
      });
      CalibrationDevice.findOne.mockResolvedValueOnce(null);

      const result = await createCalibrationRecord("tenant-1", "user-1", {
        deviceId: "device-1",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toContain("Device not found");
    });

    it("should create record successfully without updating device nextCalibrationDate if details missing", async () => {
      validator.createCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: { deviceId: "device-1" },
      });
      const mockDevice = { id: "device-1", tenantId: "tenant-1" };
      CalibrationDevice.findOne.mockResolvedValueOnce(mockDevice);
      CalibrationRecord.create.mockResolvedValueOnce({ id: "record-1" });

      const result = await createCalibrationRecord("tenant-1", "user-1", {
        deviceId: "device-1",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
    });

    it("should create record and update nextCalibrationDate if validation info exists", async () => {
      const inputVal = {
        deviceId: "device-1",
        calibrationDate: "2026-06-01",
      };
      validator.createCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: inputVal,
      });
      const mockDevice = {
        id: "device-1",
        tenantId: "tenant-1",
        calibrationIntervalDays: 180,
        update: jest.fn().mockResolvedValueOnce(true),
      };
      CalibrationDevice.findOne.mockResolvedValueOnce(mockDevice);
      CalibrationRecord.create.mockResolvedValueOnce({ id: "record-1" });

      const result = await createCalibrationRecord("tenant-1", "user-1", inputVal);

      expect(result.success).toBe(true);
      expect(mockDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          nextCalibrationDate: expect.any(Date),
        }),
      );
    });

    it("should handle error during creation", async () => {
      validator.createCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: { deviceId: "device-1" },
      });
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        createCalibrationRecord("tenant-1", "user-1", { deviceId: "device-1" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("updateCalibrationRecord", () => {
    it("should throw 400 when validation fails", async () => {
      validator.updateCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: { details: [{ path: ["notes"], message: "notes error" }] },
      });

      await expect(
        updateCalibrationRecord("tenant-1", "record-1", { notes: 123 }),
      ).rejects.toEqual(
        expect.objectContaining({
          status: 400,
        }),
      );
    });

    it("should return 404 if record is not found", async () => {
      validator.updateCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: { notes: "some notes" },
      });
      CalibrationRecord.findOne.mockResolvedValueOnce(null);

      const result = await updateCalibrationRecord("tenant-1", "record-1", {
        notes: "some notes",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should update record successfully", async () => {
      validator.updateCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: { notes: "some notes" },
      });
      const mockRecord = {
        id: "record-1",
        update: jest.fn().mockResolvedValueOnce(true),
      };
      CalibrationRecord.findOne.mockResolvedValueOnce(mockRecord);

      const result = await updateCalibrationRecord("tenant-1", "record-1", {
        notes: "some notes",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockRecord.update).toHaveBeenCalledWith({ notes: "some notes" });
    });

    it("should handle error during update", async () => {
      validator.updateCalibrationRecordSchema.validate.mockReturnValueOnce({
        error: null,
        value: { notes: "some notes" },
      });
      CalibrationRecord.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        updateCalibrationRecord("tenant-1", "record-1", { notes: "some notes" }),
      ).rejects.toThrow("Db error");
    });
  });

  describe("deleteCalibrationRecord", () => {
    it("should return 404 if record not found", async () => {
      CalibrationRecord.findOne.mockResolvedValueOnce(null);

      const result = await deleteCalibrationRecord("tenant-1", "record-1");

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
    });

    it("should delete record successfully", async () => {
      const mockRecord = {
        id: "record-1",
        softDelete: jest.fn().mockResolvedValueOnce(true),
      };
      CalibrationRecord.findOne.mockResolvedValueOnce(mockRecord);

      const result = await deleteCalibrationRecord("tenant-1", "record-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockRecord.softDelete).toHaveBeenCalled();
    });

    it("should handle error during delete", async () => {
      CalibrationRecord.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        deleteCalibrationRecord("tenant-1", "record-1"),
      ).rejects.toThrow("Db error");
    });
  });
});
