/**
 * W-30 / W-03 — maintenance.service#createWorkOrder as the calibration scan
 * calls it.
 *
 * W-30: the scan passed no actor (`{}`), and logAction refuses an entry that
 * names neither a user nor a system actor (A-124) — inside the transaction, so
 * the work order was rolled back. Every work order the SCHEDULED scan tried to
 * create since A-190 was lost this way and counted as a per-device error. The
 * first test below is the fail-before: it is exactly what the scan did.
 *
 * W-03: the partial unique index of migration 0060 turns a second open
 * auto-scheduled work order into a unique violation; the service reports it as
 * 409 (a state conflict), which the scan counts as a skip.
 *
 * Effects against the auditLedger fixture (real audit ENUM, NOT NULL columns,
 * migration 0033's actor CHECK, real rollback).
 */
const { createLedger } = require("../fixtures/auditLedger");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mockRef = { ledger: null, createError: null };

jest.mock("../../models", () => ({
  MaintenanceWorkOrder: {
    create: async (values, options) => {
      if (mockRef.createError) {
        throw mockRef.createError;
      }
      mockRef.ledger.write("maintenance_work_orders", values, options);
      return { id: "wo-new", ...values };
    },
  },
  CalibrationDevice: {
    findOne: async ({ where }) => (where.id === "dev-a" && where.tenantId === TENANT_A ? { id: "dev-a" } : null),
  },
  Vendor: { findOne: async () => null },
  User: { findOne: async () => null },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/webhook.service", () => ({ emitAfterCommit: jest.fn() }));

const maintenance = require("../../services/maintenance.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const SCAN_ORDER = {
  deviceId: "dev-a",
  title: "Overdue calibration: Pump",
  type: "Preventative",
  status: "Open",
  priority: "Critical",
  autoScheduled: true,
};

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.createError = null;
  jest.spyOn(logger, "error").mockImplementation(() => logger);
});
afterEach(() => jest.restoreAllMocks());

describe("W-30 — a work order created by a job names the job", () => {
  it("with NO actor (what the scan passed before) the work order is rolled back", async () => {
    await expect(maintenance.createWorkOrder(TENANT_A, SCAN_ORDER, {})).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("must name its actor"),
    });
    expect(mockRef.ledger.committed("maintenance_work_orders")).toEqual([]);
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });

  it("with the system actor it commits the work order and ONE audit row naming the job", async () => {
    const result = await maintenance.createWorkOrder(TENANT_A, SCAN_ORDER, {
      systemActor: "system:calibration-scan",
    });

    expect(result.status).toBe(201);
    expect(mockRef.ledger.committed("maintenance_work_orders")).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, deviceId: "dev-a", autoScheduled: true }),
    ]);
    const rows = mockRef.ledger.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_A,
      userId: null,
      actorType: "system",
      actorName: "system:calibration-scan",
      action: "CREATE",
      resourceType: "MaintenanceWorkOrder",
      resourceId: "wo-new",
    });
  });
});

describe("W-03 — a second open auto-scheduled work order is a 409", () => {
  it("maps the partial unique index's violation to 409 with a state explanation", async () => {
    const err = new Error("Validation error");
    err.name = "SequelizeUniqueConstraintError";
    mockRef.createError = err;

    await expect(
      maintenance.createWorkOrder(TENANT_A, SCAN_ORDER, { systemActor: "system:calibration-scan" }),
    ).rejects.toEqual({
      status: 409,
      message: "This device already has an open auto-scheduled calibration work order",
    });
    expect(mockRef.ledger.auditRows()).toEqual([]);
  });
});
