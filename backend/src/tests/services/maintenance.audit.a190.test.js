/**
 * A-190 (first two parts) and A-220.
 *
 *  - maintenance.service writes work orders in a transaction with ONE audit row
 *    each (create, update, delete), in the tenant's trail; the webhook is tied
 *    to the commit (A-11) — a rolled-back change announces nothing.
 *  - POST /predictive-maintenance/analyze/:deviceId stores its recommendation,
 *    the tenant notification and ONE audit row together.
 *  - A-220: a work order may reference only its own tenant's device, vendor
 *    and assignee; another tenant's id is 404, like a missing one.
 *  - Two tenants: tenant B's work order / device is 404 to tenant A for every
 *    write, and nothing is written.
 *
 * Effects against the auditLedger fixture (real audit ENUM, NOT NULL columns,
 * migration 0033's actor CHECK, real rollback) with `cls: false`: a write that
 * does not carry `{ transaction }` autocommits and survives the rollback.
 */
const { createLedger } = require("../fixtures/auditLedger");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockRef = { ledger: null, orders: [], devices: [], vendors: [], users: [], readings: { total: 0, anomalies: 0 } };

const mockOwned = (rows, where) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) || null;

const mockRow = (table, fields) => {
  const row = { ...fields };
  row.update = async (values, options) => {
    mockRef.ledger.write(table, { id: row.id, ...values }, options);
    Object.assign(row, values);
    return row;
  };
  row.destroy = async (options) => mockRef.ledger.write(table, { id: row.id, destroyed: true }, options);
  row.toJSON = () => ({ ...fields });
  return row;
};

// D-22 (ADR-070): a parent's delete soft-deletes its attachments through
// attachment.service, in the parent's transaction.
jest.mock("../../services/attachment.service", () => ({
  softDeleteForResource: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../models", () => ({
  MaintenanceWorkOrder: {
    findOne: async ({ where }) => mockOwned(mockRef.orders, where),
    create: async (values, options) => {
      mockRef.ledger.write("maintenance_work_orders", values, options);
      return { id: "wo-new", ...values };
    },
  },
  CalibrationDevice: {
    findOne: async ({ where }) =>
      mockRef.devices.find(
        (d) => d.id === where.id && d.tenantId === where.tenantId && (where.iotEnabled === undefined || d.iotEnabled),
      ) || null,
  },
  Vendor: { findOne: async ({ where }) => mockOwned(mockRef.vendors, where) },
  User: { findOne: async ({ where }) => mockOwned(mockRef.users, where) },
  IotReading: {
    count: async ({ where }) => (where.isAnomaly ? mockRef.readings.anomalies : mockRef.readings.total),
  },
  Notification: {
    create: async (values, options) => mockRef.ledger.write("notifications", values, options),
  },
  sequelize: { transaction: (...args) => mockRef.ledger.transaction(...args) },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/webhook.service", () => ({ emitAfterCommit: jest.fn() }));

const maintenance = require("../../services/maintenance.service");
const predictive = require("../../services/predictiveMaintenance.service");
const webhookService = require("../../services/webhook.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const actorA = { userId: "user-a", tenantId: TENANT_A, ipAddress: "10.0.0.1", userAgent: "UA" };
const actorB = { userId: "user-b", tenantId: TENANT_B, ipAddress: "10.0.0.2", userAgent: "UA" };

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.orders = [
    mockRow("maintenance_work_orders", {
      id: "wo-a", tenantId: TENANT_A, deviceId: "dev-a", title: "Pump service", type: "Repair", status: "Open", priority: "High", vendorId: null, assignedTo: null,
    }),
  ];
  mockRef.devices = [
    mockRow("calibration_devices", { id: "dev-a", tenantId: TENANT_A, name: "Infusion pump", iotEnabled: true, calibrationIntervalDays: 30, recommendedCalibrationInterval: null, recommendationReason: null }),
    mockRow("calibration_devices", { id: "dev-b", tenantId: TENANT_B, name: "Ventilator", iotEnabled: true, calibrationIntervalDays: 30 }),
  ];
  mockRef.vendors = [{ id: "ven-a", tenantId: TENANT_A }, { id: "ven-b", tenantId: TENANT_B }];
  mockRef.users = [{ id: "user-a", tenantId: TENANT_A }, { id: "user-b", tenantId: TENANT_B }];
  mockRef.readings = { total: 200, anomalies: 20 }; // 10% → shorten by half
  webhookService.emitAfterCommit.mockClear();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const CASES = [
  {
    name: "createWorkOrder",
    table: "maintenance_work_orders",
    run: (a) => maintenance.createWorkOrder(TENANT_A, { deviceId: "dev-a", title: "Calibrate", type: "Preventative", status: "Open", priority: "Medium", vendorId: "ven-a", assigneeId: "user-a" }, a),
    row: {
      action: "CREATE",
      resourceType: "MaintenanceWorkOrder",
      resourceId: "wo-new",
      changes: {
        before: {},
        after: { deviceId: "dev-a", title: "Calibrate", type: "Preventative", status: "Open", priority: "Medium", vendorId: "ven-a", assignedTo: "user-a" },
      },
    },
  },
  {
    name: "updateWorkOrder",
    table: "maintenance_work_orders",
    run: (a) => maintenance.updateWorkOrder(TENANT_A, "wo-a", { status: "Completed", assigneeId: "user-a", description: "done" }, a),
    row: {
      action: "UPDATE",
      resourceType: "MaintenanceWorkOrder",
      resourceId: "wo-a",
      changes: { before: { status: "Open", assignedTo: null }, after: { status: "Completed", assignedTo: "user-a" } },
    },
  },
  {
    name: "deleteWorkOrder",
    table: "maintenance_work_orders",
    run: (a) => maintenance.deleteWorkOrder(TENANT_A, "wo-a", a),
    row: {
      action: "DELETE",
      resourceType: "MaintenanceWorkOrder",
      resourceId: "wo-a",
      changes: {
        before: { deviceId: "dev-a", title: "Pump service", type: "Repair", status: "Open", priority: "High", vendorId: null, assignedTo: null },
        after: { deleted: true },
      },
    },
  },
  {
    name: "predictive analyzeDevice",
    table: "calibration_devices",
    run: (a) => predictive.analyzeDevice(TENANT_A, "dev-a", a),
    row: {
      action: "UPDATE",
      resourceType: "CalibrationDevice",
      resourceId: "dev-a",
      changes: {
        operation: "RECOMMEND_INTERVAL",
        before: { recommendedCalibrationInterval: null, recommendationReason: null },
        after: expect.objectContaining({ recommendedCalibrationInterval: 15, calibrationIntervalDays: 30, anomalyRate: 0.1, totalReadings: 200 }),
      },
    },
  },
];

describe("A-190 — work-order and recommendation writes carry their audit row, inside the transaction", () => {
  describe.each(CASES)("$name", ({ run, table, row }) => {
    it("commits the change with exactly one audit row in the tenant, naming the actor", async () => {
      await run(actorA);

      expect(mockRef.ledger.committed(table).length).toBeGreaterThan(0);
      expect(mockRef.ledger.auditRows()).toEqual([
        expect.objectContaining({ tenantId: TENANT_A, userId: "user-a", actorType: "user", ipAddress: "10.0.0.1", userAgent: "UA", ...row }),
      ]);
    });

    it("a failing audit insert rolls the change back", async () => {
      mockRef.ledger.failNext("audit_logs", new Error("audit insert failed"));

      await expect(run(actorA)).rejects.toMatchObject({ message: "audit insert failed" });

      expect(mockRef.ledger.committed(table)).toEqual([]);
      expect(mockRef.ledger.committed("notifications")).toEqual([]);
      expect(mockRef.ledger.auditRows()).toEqual([]);
    });

    it("with no actor the change is refused, not committed unattributed (A-124)", async () => {
      await expect(run({})).rejects.toMatchObject({ message: expect.stringMatching(/must name its actor/) });

      expect(mockRef.ledger.committed(table)).toEqual([]);
    });
  });

  it("the work-order webhooks are handed the transaction, so a rollback announces nothing (A-11)", async () => {
    await maintenance.createWorkOrder(TENANT_A, { deviceId: "dev-a", title: "X", type: "Repair" }, actorA);
    await maintenance.updateWorkOrder(TENANT_A, "wo-a", { status: "Completed" }, actorA);

    const transactions = webhookService.emitAfterCommit.mock.calls.map(([tx]) => tx);
    expect(transactions).toHaveLength(2);
    for (const tx of transactions) {
      expect(tx).toEqual(expect.objectContaining({ commit: expect.any(Function) }));
    }
  });

  it("the analysis writes the recommendation, the notification and the audit row together", async () => {
    await predictive.analyzeDevice(TENANT_A, "dev-a", actorA);

    expect(mockRef.ledger.committed("calibration_devices")).toEqual([
      expect.objectContaining({ id: "dev-a", recommendedCalibrationInterval: 15 }),
    ]);
    expect(mockRef.ledger.committed("notifications")).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, type: "MAINTENANCE" }),
    ]);
  });

  it("an analysis that recommends nothing writes nothing and records nothing", async () => {
    mockRef.readings = { total: 5, anomalies: 0 }; // too few readings: skipped

    await expect(predictive.analyzeDevice(TENANT_A, "dev-a", actorA)).resolves.toMatchObject({ status: "skipped" });
    mockRef.readings = { total: 50, anomalies: 0 }; // stable, small sample: unchanged
    await expect(predictive.analyzeDevice(TENANT_A, "dev-a", actorA)).resolves.toMatchObject({ status: "unchanged" });

    expect(mockRef.ledger.rows).toEqual([]);
  });
});

describe("A-190 — two tenants: another tenant's work order or device is 404 for every write", () => {
  it.each([
    ["update", () => maintenance.updateWorkOrder(TENANT_B, "wo-a", { status: "Cancelled" }, actorB)],
    ["delete", () => maintenance.deleteWorkOrder(TENANT_B, "wo-a", actorB)],
  ])("tenant B cannot %s tenant A's work order: 404, as for one that does not exist", async (_name, run) => {
    await expect(run()).rejects.toEqual({ status: 404, message: "Maintenance work order not found" });
    await expect(maintenance.deleteWorkOrder(TENANT_B, "wo-missing", actorB)).rejects.toEqual({
      status: 404,
      message: "Maintenance work order not found",
    });
    expect(mockRef.ledger.rows).toEqual([]);
    expect(mockRef.orders[0].status).toBe("Open");
  });

  it("tenant B cannot analyse tenant A's device: 404, and nothing is written", async () => {
    await expect(predictive.analyzeDevice(TENANT_B, "dev-a", actorB)).rejects.toMatchObject({ status: 404 });
    expect(mockRef.ledger.rows).toEqual([]);
  });
});

describe("A-220 — a work order references only its own tenant's device, vendor and assignee", () => {
  it.each([
    ["device", { deviceId: "dev-b" }, "Device not found"],
    ["vendor", { deviceId: "dev-a", vendorId: "ven-b" }, "Vendor not found"],
    ["assignee", { deviceId: "dev-a", assigneeId: "user-b" }, "Assignee not found"],
  ])("creating one with another tenant's %s is 404 and writes nothing", async (_name, refs, message) => {
    await expect(
      maintenance.createWorkOrder(TENANT_A, { title: "X", type: "Repair", ...refs }, actorA),
    ).rejects.toEqual({ status: 404, message });
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("re-assigning one to another tenant's user or vendor is 404 and changes nothing", async () => {
    await expect(maintenance.updateWorkOrder(TENANT_A, "wo-a", { assigneeId: "user-b" }, actorA)).rejects.toEqual({
      status: 404,
      message: "Assignee not found",
    });
    await expect(maintenance.updateWorkOrder(TENANT_A, "wo-a", { vendorId: "ven-b" }, actorA)).rejects.toEqual({
      status: 404,
      message: "Vendor not found",
    });
    expect(mockRef.ledger.rows).toEqual([]);
    expect(mockRef.orders[0].assignedTo).toBeNull();
  });

  it("clearing a vendor or an assignee (null) needs no lookup", async () => {
    await maintenance.updateWorkOrder(TENANT_A, "wo-a", { vendorId: null, assigneeId: null }, actorA);

    expect(mockRef.ledger.committed("maintenance_work_orders")).toEqual([
      expect.objectContaining({ id: "wo-a", vendorId: null, assignedTo: null }),
    ]);
  });
});
