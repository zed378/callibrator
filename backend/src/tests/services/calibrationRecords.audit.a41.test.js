/**
 * A-41 — calibration records are ISO 17025 §7.5 technical records: every
 * create/correct/void writes its audit rows inside the same transaction
 * (MEMORY/specs/A-41-audit-inside-transaction.md, rows 8–10). P6-03 replaced
 * update and delete with correct (a superseding record) and void.
 *
 * Effects against the auditLedger fixture (real ENUM, real rollback), with
 * `cls: false` so every write must carry `{ transaction }` explicitly.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, record: null, device: null };

jest.mock("../../models", () => ({
  CalibrationRecord: {
    findOne: jest.fn(async () => mockRef.record),
    unscoped: () => ({ findOne: async () => mockRef.record }),
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
  correctCalibrationRecordSchema: { validate: (v) => ({ value: v }) },
  voidCalibrationRecordSchema: { validate: (v) => ({ value: v }) },
}));

const service = require("../../services/calibrationRecords.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const makeRecord = () => {
  const record = { id: "rec-1", deviceId: "dev-1", notes: "pass", isDeleted: false, supersededById: null };
  record.update = async (values, options) => {
    Object.assign(record, values);
    return mockRef.ledger.write("calibration_records", { id: record.id, ...values }, options);
  };
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
    name: "correctCalibrationRecord",
    run: () =>
      service.correctCalibrationRecord("tenant-1", "user-1", "rec-1", { notes: "fail", reason: "misread" }, actor),
    // The superseding record's CREATE, then the original's UPDATE (superseded).
    actions: [
      ["CREATE", "rec-new"],
      ["UPDATE", "rec-1"],
    ],
    table: "calibration_records",
  },
  {
    name: "voidCalibrationRecord",
    run: () => service.voidCalibrationRecord("tenant-1", "user-1", "rec-1", { reason: "entered twice" }, actor),
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

  describe.each(CASES)("$name", ({ run, action, resourceId, actions, table }) => {
    it("commits the change with its valid audit row(s) naming the actor", async () => {
      await run();

      expect(mockRef.ledger.committed(table).length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual(
        (actions || [[action, resourceId]]).map(([a, id]) =>
          expect.objectContaining({
            tenantId: "tenant-1",
            userId: "user-1",
            action: a,
            resourceType: "CalibrationRecord",
            resourceId: id,
            ipAddress: "10.0.0.1",
            userAgent: "UA",
            changes: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }),
          }),
        ),
      );
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

  it("correct: the original is never rewritten — only its supersession is committed", async () => {
    await CASES[1].run();
    const rows = mockRef.ledger.committed("calibration_records");
    expect(rows).toEqual([
      expect.objectContaining({ op: "create", supersedesId: "rec-1", correctionReason: "misread", notes: "fail" }),
      { id: "rec-1", supersededById: "rec-new", supersededAt: expect.any(Date) },
    ]);
  });

  it("void: sets isDeleted (not is_deleted), the reason and who, in the committed row", async () => {
    await CASES[2].run();
    expect(mockRef.ledger.committed("calibration_records")).toEqual([
      { id: "rec-1", isDeleted: true, voidReason: "entered twice", voidedBy: "user-1" },
    ]);
  });
});
