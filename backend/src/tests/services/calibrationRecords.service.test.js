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

// P21-05 (ADR-133 § 1): the next due date is re-derived by calibrationDates.service, whose own
// suites (calibrationRecords.nextDate.p2105, calibrationDates.p2105) prove the rule; here the call.
jest.mock("../../services/calibrationDates.service", () => ({
  rederiveNextCalibrationDate: jest.fn().mockResolvedValue(null),
  performerSnapshotFor: jest.fn().mockResolvedValue({ name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" }),
}));

jest.mock("../../models", () => ({
  CalibrationRecord: {
    // U-06 (ADR-119): the list is a count and a page, no longer one call.
    count: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    unscoped: jest.fn(),
  },
  CalibrationDevice: {
    findOne: jest.fn(),
  },
  // Q-51 (ADR-100 Am. 2): the key actor is included through ApiKey.scope("includeDeleted").
  ApiKey: { scope: jest.fn(() => "ApiKey(includeDeleted)") },
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

// The create / correct / void schemas are REAL (P9-11: Zod through
// validators/input): each body below is one the API accepts, and the 400
// cases are the schema's own refusals.

const { CalibrationRecord, CalibrationDevice } = require("../../models");
const {
  fetchCalibrationRecords,
  fetchSpecificCalibrationRecord,
  createCalibrationRecord,
  correctCalibrationRecord,
  voidCalibrationRecord,
} = require("../../services/calibrationRecords.service");
const { db } = require("../../config");
const auditService = require("../../services/audit.service");

// Ids the request schemas accept (they are uuids since P9-11 validates for real).
const DEVICE_1 = "00000001-0000-4000-8000-000000000001";
const DEVICE_2 = "00000002-0000-4000-8000-000000000002";
const DEVICE_OTHER = "00000003-0000-4000-8000-000000000003";

describe("calibrationRecords.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchCalibrationRecords", () => {
    // U-06 (ADR-119): the service counts and reads the page as two statements;
    // this answers both, as the one findAndCountAll double answered them.
    const listResolves = ({ rows, count }) => {
      CalibrationRecord.count.mockResolvedValueOnce(count);
      CalibrationRecord.findAll.mockResolvedValueOnce(rows);
    };

    // A-90: the includes are LEFT JOINs (SQL asserted in includes.a90.test.js);
    // a record whose device and performer are gone is listed with both null.
    it("A-90: lists a record whose device and performer are null, asking for LEFT joins", async () => {
      const orphan = { id: "record-1", device: null, performer: null };
      listResolves({ rows: [orphan], count: 1 });

      const result = await fetchCalibrationRecords({ tenantId: "tenant-1" });

      expect(result.data.rows).toEqual([orphan]);
      expect(result.data.meta.total).toBe(1);
      const { include } = CalibrationRecord.findAll.mock.calls[0][0];
      expect(include.map((i) => [i.association ?? i.as, i.required])).toEqual([
        ["device", false],
        ["performer", false],
        ["apiKey", false],
      ]);
      // Q-51: the key's id, name and prefix only — never keyHash.
      expect(include[2]).toMatchObject({ model: "ApiKey(includeDeleted)", attributes: ["id", "name", "keyPrefix"] });
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
      listResolves({ rows: [{ id: "record-1" }], count: 1 });

      const result = await fetchCalibrationRecords({ tenantId: "tenant-1" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.rows).toHaveLength(1);
    });

    it("should fetch records with all optional filters (deviceId, isCompliant, from, to)", async () => {
      listResolves({ rows: [{ id: "record-1" }], count: 1 });

      const result = await fetchCalibrationRecords({
        tenantId: "tenant-1",
        deviceId: DEVICE_1,
        isCompliant: true,
        from: "2026-01-01",
        to: "2026-06-30",
        page: 2,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(CalibrationRecord.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            deviceId: DEVICE_1,
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
      listResolves({ rows: [], count: 0 });

      await fetchCalibrationRecords({ tenantId: "tenant-1", from: "2026-01-01" });

      const where = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(where.calibrationDate[Op.gte]).toBe("2026-01-01");
      expect(where.calibrationDate[Op.lte]).toBeUndefined();
    });

    it("applies only an upper bound when `to` is given without `from`", async () => {
      const { Op } = require("sequelize");
      listResolves({ rows: [], count: 0 });

      await fetchCalibrationRecords({ tenantId: "tenant-1", to: "2026-06-30" });

      const where = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(where.calibrationDate[Op.lte]).toBe("2026-06-30");
      expect(where.calibrationDate[Op.gte]).toBeUndefined();
    });

    it("omits the calibrationDate filter entirely when neither bound is given", async () => {
      listResolves({ rows: [], count: 0 });

      await fetchCalibrationRecords({ tenantId: "tenant-1" });

      const where = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("calibrationDate");
    });

    it("P6-03: lists only the record in force by default — a superseded record is excluded", async () => {
      listResolves({ rows: [], count: 0 });
      await fetchCalibrationRecords({ tenantId: "tenant-1" });
      const where = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(where).toHaveProperty("supersededById", null);
    });

    it("P6-03: includeSuperseded lists the correction history too", async () => {
      listResolves({ rows: [], count: 0 });
      await fetchCalibrationRecords({ tenantId: "tenant-1", includeSuperseded: true });
      const where = CalibrationRecord.findAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("supersededById");
    });

    it("should handle error during fetching", async () => {
      CalibrationRecord.count.mockResolvedValueOnce(0);
      CalibrationRecord.findAll.mockRejectedValueOnce(new Error("Db error"));
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
      await expect(
        createCalibrationRecord("tenant-1", "user-1", {}),
      ).rejects.toEqual({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "deviceId", message: "Invalid input: expected string, received undefined" }],
      });
      expect(CalibrationDevice.findOne).not.toHaveBeenCalled();
    });

    it("should return 404 if device not found or belongs to another tenant", async () => {
      CalibrationDevice.findOne.mockResolvedValueOnce(null);

      const result = await createCalibrationRecord("tenant-1", "user-1", {
        deviceId: DEVICE_1,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toContain("Device not found");
    });

    it("should create record successfully without updating device nextCalibrationDate if details missing", async () => {
      const mockDevice = { id: DEVICE_1, tenantId: "tenant-1" };
      CalibrationDevice.findOne.mockResolvedValueOnce(mockDevice);
      CalibrationRecord.create.mockResolvedValueOnce({ id: "record-1" });

      const result = await createCalibrationRecord("tenant-1", "user-1", {
        deviceId: DEVICE_1,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
    });

    // P21-05 (G-11, ADR-133 § 1): re-baselined. The create no longer sets the date from THIS
    // record (+ interval) — an older record moved it backward; it re-derives it from the device's
    // latest effective record, in the record's transaction.
    it("should create record and re-derive the device's nextCalibrationDate in the transaction", async () => {
      const { rederiveNextCalibrationDate } = require("../../services/calibrationDates.service");
      const inputVal = {
        deviceId: DEVICE_1,
        calibrationDate: "2026-06-01",
      };
      const mockDevice = {
        id: DEVICE_1,
        tenantId: "tenant-1",
        calibrationIntervalDays: 180,
        update: jest.fn().mockResolvedValueOnce(true),
      };
      CalibrationDevice.findOne.mockResolvedValueOnce(mockDevice);
      CalibrationRecord.create.mockResolvedValueOnce({ id: "record-1" });

      const result = await createCalibrationRecord("tenant-1", "user-1", inputVal);

      expect(result.success).toBe(true);
      expect(rederiveNextCalibrationDate).toHaveBeenCalledWith(
        "tenant-1",
        DEVICE_1,
        { recordId: "record-1", newRecord: true },
        expect.objectContaining({ userId: "user-1" }),
        "TX",
      );
    });

    it("should handle error during creation", async () => {
      CalibrationDevice.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expect(
        createCalibrationRecord("tenant-1", "user-1", { deviceId: DEVICE_1 }),
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
      deviceId: DEVICE_1,
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

      it("400 when validation fails (a missing or blank reason is refused by the schema)", async () => {
        await expect(
          correctCalibrationRecord("tenant-1", "user-1", "record-1", { notes: "x" }),
        ).rejects.toEqual({
          status: 400,
          message: "Validation failed",
          errors: [{ field: "reason", message: "Invalid input: expected string, received undefined" }],
        });
        await expect(
          correctCalibrationRecord("tenant-1", "user-1", "record-1", { notes: "x", reason: "   " }),
        ).rejects.toEqual({
          status: 400,
          message: "Validation failed",
          errors: [{ field: "reason", message: "Too small: expected string to have >=3 characters" }],
        });
        expect(CalibrationRecord.create).not.toHaveBeenCalled();
      });

      it("404 when the corrected device is not in the tenant", async () => {
        const body = { deviceId: DEVICE_OTHER, reason: "wrong device" };
        CalibrationDevice.findOne.mockResolvedValueOnce(null);
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.status).toBe(404);
        expect(CalibrationDevice.findOne).toHaveBeenCalledWith({ where: { id: DEVICE_OTHER, tenantId: "tenant-1" } });
        expect(db.transaction).not.toHaveBeenCalled();
      });

      it("404 when the record is not in the caller's tenant — never 403", async () => {
        const body = { notes: "x", reason: "typo" };
        lockedFindOne.mockResolvedValueOnce(null);
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result).toEqual({ success: false, status: 404, message: "Calibration record not found", data: null });
        expect(lockedFindOne).toHaveBeenCalledWith({
          where: { id: "record-1", tenantId: "tenant-1" },
          paranoid: false,
          transaction: TX,
          lock: "UPDATE",
        });
      });

      it("409 when the record was voided, quoting the void reason", async () => {
        const body = { notes: "x", reason: "typo" };
        lockedFindOne.mockResolvedValueOnce(original({ isDeleted: true, voidReason: "entered twice" }));
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.status).toBe(409);
        expect(result.message).toMatch(/voided \("entered twice"\) and cannot be corrected: a void is final/);
      });

      it("409 for a voided record with no recorded reason", async () => {
        const body = { notes: "x", reason: "typo" };
        lockedFindOne.mockResolvedValueOnce(original({ isDeleted: true, voidReason: null }));
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.message).toMatch(/^This calibration record was voided and cannot be corrected/);
      });

      it("409 when the record was already corrected, naming the correction", async () => {
        const body = { notes: "x", reason: "typo" };
        lockedFindOne.mockResolvedValueOnce(original({ supersededById: "record-2" }));
        const result = await correctCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.status).toBe(409);
        expect(result.message).toMatch(/already corrected by record record-2\. Correct the latest correction/);
        expect(CalibrationRecord.create).not.toHaveBeenCalled();
      });

      it("writes a NEW superseding record, marks the original once, and audits both in the transaction", async () => {
        const body = { isCompliant: false, deviceId: DEVICE_2, reason: "reference drifted" };
        CalibrationDevice.findOne.mockResolvedValueOnce({ id: DEVICE_2 });
        const rec = original();
        lockedFindOne.mockResolvedValueOnce(rec);
        CalibrationRecord.create.mockResolvedValueOnce({ id: "record-2" });

        const result = await correctCalibrationRecord(
          "tenant-1",
          "user-9",
          "record-1",
          body,
          { ipAddress: "10.0.0.1", userAgent: "jest" },
        );

        expect(result).toEqual(expect.objectContaining({ success: true, status: 201, data: { id: "record-2" } }));
        expect(CalibrationRecord.create).toHaveBeenCalledWith(
          {
            deviceId: DEVICE_2,
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
            apiKeyId: null, // Q-51: the original's actor, a user
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
                // P9-11: the validated value follows the schema's key order
                changed: ["deviceId", "isCompliant"],
              }),
            },
          }),
        );
        expect(calls.every(([, opts]) => opts.transaction === TX)).toBe(true);
      });

      it("rethrows a database error", async () => {
        const body = { notes: "x", reason: "typo" };
        lockedFindOne.mockRejectedValueOnce(new Error("Db error"));
        await expect(correctCalibrationRecord("tenant-1", "user-1", "record-1", body)).rejects.toThrow("Db error");
      });
    });

    describe("voidCalibrationRecord", () => {

      it("400 when the reason is missing", async () => {
        await expect(voidCalibrationRecord("tenant-1", "user-1", "record-1", {})).rejects.toEqual({
          status: 400,
          message: "Validation failed",
          errors: [{ field: "reason", message: "Invalid input: expected string, received undefined" }],
        });
        expect(lockedFindOne).not.toHaveBeenCalled();
      });

      it("404 when the record is not in the caller's tenant", async () => {
        const body = { reason: "entered twice" };
        lockedFindOne.mockResolvedValueOnce(null);
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.status).toBe(404);
      });

      it("409 when already voided — a void is final", async () => {
        const body = { reason: "entered twice" };
        lockedFindOne.mockResolvedValueOnce(original({ isDeleted: true, voidReason: "dup" }));
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.status).toBe(409);
        expect(result.message).toMatch(/cannot be voided again: a void is final/);
      });

      it("409 when the record was corrected — void the latest correction", async () => {
        const body = { reason: "entered twice" };
        lockedFindOne.mockResolvedValueOnce(original({ supersededById: "record-2" }));
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", body);
        expect(result.message).toMatch(/Void the latest correction instead/);
      });

      it("sets the void columns once and audits a DELETE in the transaction", async () => {
        const body = { reason: "entered twice" };
        const rec = original();
        lockedFindOne.mockResolvedValueOnce(rec);
        const result = await voidCalibrationRecord("tenant-1", "user-1", "record-1", body, { ipAddress: "1.2.3.4" });
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
        const body = { reason: "entered twice" };
        lockedFindOne.mockRejectedValueOnce(new Error("Db error"));
        await expect(voidCalibrationRecord("tenant-1", "user-1", "record-1", body)).rejects.toThrow("Db error");
      });
    });
  });
});
