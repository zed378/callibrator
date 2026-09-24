/**
 * Tests for calibrationRecords.service.js
 */

jest.mock("sequelize", () => ({
  Op: {
    gte: Symbol("gte"),
    lte: Symbol("lte"),
  },
  Transaction: { LOCK: { UPDATE: "UPDATE" } },
}));

// A-41: mutations run in a managed transaction and audit through logAction.
// In-transaction effects are asserted in calibrationRecords.audit.a41.test.js.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../models", () => ({
  CalibrationRecord: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    unscoped: jest.fn(),
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
  correctCalibrationRecordSchema: {
    validate: jest.fn(),
  },
  voidCalibrationRecordSchema: {
    validate: jest.fn(),
  },
}));

const { CalibrationRecord, CalibrationDevice } = require("../../models");
const validator = require("../../validators/calibrationRecords.validator");
const {
  fetchCalibrationRecords,
  fetchSpecificCalibrationRecord,
  createCalibrationRecord,
  correctCalibrationRecord,
  voidCalibrationRecord,
} = require("../../services/calibrationRecords.service");
const { db } = require("../../config");
const auditService = require("../../services/audit.service");

describe("calibrationRecords.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchCalibrationRecords", () => {
    // A-90: the includes are LEFT JOINs (SQL asserted in includes.a90.test.js);
    // a record whose device and performer are gone is listed with both null.
    it("A-90: lists a record whose device and performer are null, asking for LEFT joins", async () => {
      const orphan = { id: "record-1", device: null, performer: null };
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({ rows: [orphan], count: 1 });

      const result = await fetchCalibrationRecords({ tenantId: "tenant-1" });

      expect(result.data.rows).toEqual([orphan]);
      expect(result.data.meta.total).toBe(1);
      const { include } = CalibrationRecord.findAndCountAll.mock.calls[0][0];
      expect(include.map((i) => [i.association, i.required])).toEqual([
        ["device", false],
        ["performer", false],
      ]);
    });

    it("A-90: the detail of a record whose device and performer are null is found, not a 404", async () => {
      const orphan = { id: "record-1", device: null, performer: null };
      CalibrationRecord.findOne.mockResolvedValueOnce(orphan);

      const result = await fetchSpecificCalibrationRecord("tenant-1", "record-1");

      expect(result.status).toBe(200);
      expect(result.data).toBe(orphan);
      const { include } = CalibrationRecord.findOne.mock.calls[0][0];
      expect(include.every((i) => i.required === false)).toBe(true);
    });

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

    it("P6-03: lists only the record in force by default — a superseded record is excluded", async () => {
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchCalibrationRecords({ tenantId: "tenant-1" });
      const where = CalibrationRecord.findAndCountAll.mock.calls[0][0].where;
      expect(where).toHaveProperty("supersededById", null);
    });

    it("P6-03: includeSuperseded lists the correction history too", async () => {
      CalibrationRecord.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchCalibrationRecords({ tenantId: "tenant-1", includeSuperseded: true });
      const where = CalibrationRecord.findAndCountAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("supersededById");
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
        { transaction: "TX" },
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

  // P6-03 — there is no update and no delete. correct/void only INSERT a row
  // or set a lifecycle column once; the database refuses anything else
  // (proved against PostgreSQL in dataIntegrity.p6.live.test.js).
  describe("P6-03 correct / void", () => {
    const TX = { id: "TX" };
    let lockedFindOne;

    const original = (overrides = {}) => ({
      id: "record-1",
      tenantId: "tenant-1",
      deviceId: "device-1",
      performedBy: "performer-1",
      calibrationDate: "2026-01-01",
      dueDate: null,
      standard: "ISO 17025",
      results: { reading: 1 },
      measurementUncertainty: 0.1,
      isCompliant: true,
      certificateNumber: null,
      certificateFileUrl: null,
      notes: "first",
      isDeleted: false,
      supersededById: null,
      voidReason: null,
      update: jest.fn().mockResolvedValue(true),
      ...overrides,
    });

    beforeEach(() => {
      db.transaction.mockImplementation(async (cb) => cb(TX));
      lockedFindOne = jest.fn();
      CalibrationRecord.unscoped.mockReturnValue({ findOne: lockedFindOne });
    });

    afterEach(() => {
      db.transaction.mockImplementation(async (cb) => cb("TX"));
    });

    describe("correctCalibrationRecord", () => {
      const valid = (value) =>
        validator.correctCalibrationRecordSchema.validate.mockReturnValueOnce({ error: null, value });

      it("400 when validation fails (a missing or blank reason is refused by the schema)", async () => {
        validator.correctCalibrationRecordSchema.validate.mockReturnValueOnce({
          error: { details: [{ path: ["reason"], message: '"reason" is required' }] },
        });
        await expect(
          correctCalibrationRecord("tenant-1", "user-1", "record-1", { notes: "x" }),
        ).rejects.toEqual(expect.objectContaining({ status: 400 }));
        expect(CalibrationRecord.create).not.toHaveBeenCalled();
      });

      it("404 when the corrected device is not in the tenant", async () => {
        valid({ deviceId: "device-other", reason: "wrong device" });
        CalibrationDevice.findOne.mockResolvedValueOnce(null);
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.status).toBe(404);
        expect(CalibrationDevice.findOne).toHaveBeenCalledWith({ where: { id: "device-other", tenantId: "tenant-1" } });
        expect(db.transaction).not.toHaveBeenCalled();
      });

      it("404 when the record is not in the caller's tenant — never 403", async () => {
        valid({ notes: "x", reason: "typo" });
        lockedFindOne.mockResolvedValueOnce(null);
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result).toEqual({ success: false, status: 404, message: "Calibration record not found", data: null });
        expect(lockedFindOne).toHaveBeenCalledWith({
          where: { id: "record-1", tenantId: "tenant-1" },
          paranoid: false,
          transaction: TX,
          lock: "UPDATE",
        });
      });

      it("409 when the record was voided, quoting the void reason", async () => {
        valid({ notes: "x", reason: "typo" });
        lockedFindOne.mockResolvedValueOnce(original({ isDeleted: true, voidReason: "entered twice" }));
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.status).toBe(409);
        expect(result.message).toMatch(/voided \("entered twice"\) and cannot be corrected: a void is final/);
      });

      it("409 for a voided record with no recorded reason", async () => {
        valid({ notes: "x", reason: "typo" });
        lockedFindOne.mockResolvedValueOnce(original({ isDeleted: true, voidReason: null }));
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.message).toMatch(/^This calibration record was voided and cannot be corrected/);
      });

      it("409 when the record was already corrected, naming the correction", async () => {
        valid({ notes: "x", reason: "typo" });
        lockedFindOne.mockResolvedValueOnce(original({ supersededById: "record-2" }));
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.status).toBe(409);
        expect(result.message).toMatch(/already corrected by record record-2\. Correct the latest correction/);
        expect(CalibrationRecord.create).not.toHaveBeenCalled();
      });

      it("writes a NEW superseding record, marks the original once, and audits both in the transaction", async () => {
        valid({ isCompliant: false, deviceId: "device-2", reason: "reference drifted" });
        CalibrationDevice.findOne.mockResolvedValueOnce({ id: "device-2" });
        const rec = original();
        lockedFindOne.mockResolvedValueOnce(rec);
        CalibrationRecord.create.mockResolvedValueOnce({ id: "record-2" });

        const result = await correctCalibrationRecord(
          "tenant-1",
          "user-9",
          "record-1",
          {},
          { ipAddress: "10.0.0.1", userAgent: "jest" },
        );

        expect(result).toEqual(expect.objectContaining({ success: true, status: 201, data: { id: "record-2" } }));
        expect(CalibrationRecord.create).toHaveBeenCalledWith(
          {
            deviceId: "device-2",
            calibrationDate: "2026-01-01",
            dueDate: null,
            standard: "ISO 17025",
            results: { reading: 1 },
            measurementUncertainty: 0.1,
            isCompliant: false,
            certificateNumber: null,
            certificateFileUrl: null,
            notes: "first",
            tenantId: "tenant-1",
            performedBy: "performer-1",
            supersedesId: "record-1",
            correctionReason: "reference drifted",
          },
          { transaction: TX },
        );
        // The original's CONTENT is never written — only its lifecycle columns.
        expect(rec.update).toHaveBeenCalledTimes(1);
        expect(rec.update).toHaveBeenCalledWith(
          { supersededById: "record-2", supersededAt: expect.any(Date) },
          { transaction: TX },
        );
        const calls = auditService.logAction.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][0]).toEqual(
          expect.objectContaining({ action: "CREATE", resourceId: "record-2", userId: "user-9", ipAddress: "10.0.0.1" }),
        );
        expect(calls[1][0]).toEqual(
          expect.objectContaining({
            action: "UPDATE",
            resourceId: "record-1",
            changes: {
              before: { supersededById: null },
              after: expect.objectContaining({
                supersededById: "record-2",
                correctionReason: "reference drifted",
                changed: ["isCompliant", "deviceId"],
              }),
            },
          }),
        );
        expect(calls.every(([, opts]) => opts.transaction === TX)).toBe(true);
      });

      it("rethrows a database error", async () => {
        valid({ notes: "x", reason: "typo" });
        lockedFindOne.mockRejectedValueOnce(new Error("Db error"));
        await expect(correctCalibrationRecord("tenant-1", "user-1", "record-1", {})).rejects.toThrow("Db error");
      });
    });

    describe("voidCalibrationRecord", () => {
      const valid = (value) =>
        validator.voidCalibrationRecordSchema.validate.mockReturnValueOnce({ error: null, value });

      it("400 when the reason is missing", async () => {
        validator.voidCalibrationRecordSchema.validate.mockReturnValueOnce({
          error: { details: [{ path: ["reason"], message: '"reason" is required' }] },
        });
        await expect(voidCalibrationRecord("tenant-1", "user-1", "record-1", {})).rejects.toEqual(
          expect.objectContaining({ status: 400 }),
        );
      });

      it("404 when the record is not in the caller's tenant", async () => {
        valid({ reason: "entered twice" });
        lockedFindOne.mockResolvedValueOnce(null);
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.status).toBe(404);
      });

      it("409 when already voided — a void is final", async () => {
        valid({ reason: "entered twice" });
        lockedFindOne.mockResolvedValueOnce(original({ isDeleted: true, voidReason: "dup" }));
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.status).toBe(409);
        expect(result.message).toMatch(/cannot be voided again: a void is final/);
      });

      it("409 when the record was corrected — void the latest correction", async () => {
        valid({ reason: "entered twice" });
        lockedFindOne.mockResolvedValueOnce(original({ supersededById: "record-2" }));
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", {});
        expect(result.message).toMatch(/Void the latest correction instead/);
      });

      it("sets the void columns once and audits a DELETE in the transaction", async () => {
        valid({ reason: "entered twice" });
        const rec = original();
        lockedFindOne.mockResolvedValueOnce(rec);
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", {}, { ipAddress: "1.2.3.4" });
        expect(result).toEqual(expect.objectContaining({ success: true, status: 200, data: null }));
        const voided = { isDeleted: true, voidReason: "entered twice", voidedBy: "user-1" };
        expect(rec.update).toHaveBeenCalledWith(voided, { transaction: TX });
        expect(auditService.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "DELETE",
            resourceId: "record-1",
            userId: "user-1",
            changes: { before: { isDeleted: false }, after: voided },
          }),
          { transaction: TX },
        );
      });

      it("rethrows a database error", async () => {
        valid({ reason: "entered twice" });
        lockedFindOne.mockRejectedValueOnce(new Error("Db error"));
        await expect(voidCalibrationRecord("tenant-1", "user-1", "record-1", {})).rejects.toThrow("Db error");
      });
    });
  });
});
