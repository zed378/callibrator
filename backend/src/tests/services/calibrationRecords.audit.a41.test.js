/**
 * A-41 — calibration records are ISO 17025 §7.5 technical records: every
 * create/update/delete writes its audit row inside the same transaction
 * (MEMORY/specs/A-41-audit-inside-transaction.md, rows 8–10).
 *
 * Effects against the auditLedger fixture (real ENUM, real rollback), with
 * `cls: false` so every write must carry `{ transaction }` explicitly. The
 * soft delete is the REAL model method (models/calibrationRecord.model.js).
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, record: null, device: null };

jest.mock("../../models", () => ({
  CalibrationRecord: {
    findOne: jest.fn(async () => mockRef.record),
    create: jest.fn(async (values, options) => {
      mockRef.ledger.write("calibration_records", { op: "create", ...values }, options);
      return { id: "rec-new", ...values };
    }),
  },
  CalibrationDevice: { findOne: jest.fn(async () => mockRef.device) },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  User: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../validators/calibrationRecords.validator", () => ({
  createCalibrationRecordSchema: { validate: (v) => ({ value: v }) },
  updateCalibrationRecordSchema: { validate: (v) => ({ value: v }) },
}));

const { Sequelize, DataTypes } = jest.requireActual("sequelize");
const RealCalibrationRecord = jest.requireActual("../../models/calibrationRecord.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
const service = require("../../services/calibrationRecords.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const makeRecord = () => {
  const record = { id: "rec-1", deviceId: "dev-1", result: "pass", isDeleted: false };
  record.save = async (options) =>
    mockRef.ledger.write("calibration_records", { id: record.id, isDeleted: record.isDeleted, result: record.result }, options);
  record.update = async (values, options) => {
    Object.assign(record, values);
    return record.save(options);
  };
  record.softDelete = RealCalibrationRecord.prototype.softDelete;
  return record;
};

const actor = { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "UA" };

const CASES = [
  {
    name: "createCalibrationRecord",
    run: () =>
      service.createCalibrationRecord(
        "tenant-1",
        "user-1",
        { deviceId: "dev-1", calibrationDate: "2026-09-01", result: "pass" },
        actor,
      ),
    action: "CREATE",
    resourceId: "rec-new",
    table: "calibration_records",
  },
  {
    name: "updateCalibrationRecord",
    run: () => service.updateCalibrationRecord("tenant-1", "rec-1", { result: "fail" }, actor),
    action: "UPDATE",
    resourceId: "rec-1",
    table: "calibration_records",
  },
  {
    name: "deleteCalibrationRecord",
    run: () => service.deleteCalibrationRecord("tenant-1", "rec-1", actor),
    action: "DELETE",
    resourceId: "rec-1",
    table: "calibration_records",
  },
];

describe("A-41 — calibration record mutations audit inside their transaction", () => {
  beforeEach(() => {
    mockRef.ledger = createLedger({ cls: false });
    mockRef.record = makeRecord();
    mockRef.device = {
      id: "dev-1",
      calibrationIntervalDays: 365,
      update: async (values, options) =>
        mockRef.ledger.write("calibration_devices", { id: "dev-1", ...values }, options),
    };
    jest.spyOn(logger, "error").mockImplementation(() => logger);
  });

  describe.each(CASES)("$name", ({ run, action, resourceId, table }) => {
    it("commits the change with exactly one valid audit row naming the actor", async () => {
      await run();

      expect(mockRef.ledger.committed(table).length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({
          tenantId: "tenant-1",
          userId: "user-1",
          action,
          resourceType: "CalibrationRecord",
          resourceId,
          ipAddress: "10.0.0.1",
          userAgent: "UA",
          changes: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }),
        }),
      ]);
    });

    it("a failing audit insert rolls the change back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run()).rejects.toThrow("audit insert failed");

      expect(mockRef.ledger.committed(table)).toEqual([]);
      expect(mockRef.ledger.committed("calibration_devices")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("a rolled-back change leaves no audit row", async () => {
      mockRef.ledger.failNext(table, new Error("write failed"));

      await expect(run()).rejects.toThrow("write failed");

      expect(mockRef.ledger.auditRows()).toEqual([]);
    });
  });

  it("create: the device's next due date commits with the record, and rolls back with it", async () => {
    mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));
    await expect(CASES[0].run()).rejects.toThrow();
    expect(mockRef.ledger.committed("calibration_devices")).toEqual([]);

    await CASES[0].run();
    expect(mockRef.ledger.committed("calibration_devices")).toHaveLength(1);
  });

  it("delete: soft delete sets isDeleted (not is_deleted) in the committed row", async () => {
    await CASES[2].run();
    expect(mockRef.ledger.committed("calibration_records")).toEqual([
      expect.objectContaining({ id: "rec-1", isDeleted: true }),
    ]);
  });
});
