/**
 * W-30 / W-03 -- maintenance.service#createWorkOrder as the calibration scan
 * calls it.
 *
 * W-30: the scan passed no actor (`{}`), and logAction refuses an entry that
 * names neither a user nor a system actor (A-124) -- inside the transaction, so
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
import type { TenantId } from "../../types/ids";

type LedgerRow = Record<string, unknown>;
interface Ledger {
  write: (table: string, row: LedgerRow, options?: unknown) => LedgerRow;
  committed: (table: string) => LedgerRow[];
  auditRows: () => LedgerRow[];
  transaction: (...args: unknown[]) => unknown;
  failNext: (table: string, error: Error) => void;
  AuditLog: { create: (...args: unknown[]) => unknown };
}

interface MaintenanceService {
  createWorkOrder: (
    tenantId: TenantId,
    order: Record<string, unknown>,
    actor: Record<string, unknown>,
  ) => Promise<{ status: number }>;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { createLedger } = require("../fixtures/auditLedger") as { createLedger: (o: { cls: boolean }) => Ledger };
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantId;
const mockRef: { ledger: Ledger | null; createError: Error | null } = { ledger: null, createError: null };

const ledger = (): Ledger => {
  if (!mockRef.ledger) {
    throw new Error("ledger not set");
  }
  return mockRef.ledger;
};

jest.mock("../../models", () => ({
  MaintenanceWorkOrder: {
    create: (values: LedgerRow, options: unknown): Promise<LedgerRow & { id: string }> => {
      if (mockRef.createError) {
        throw mockRef.createError;
      }
      ledger().write("maintenance_work_orders", values, options);
      return Promise.resolve({ id: "wo-new", ...values });
    },
  },
  CalibrationDevice: {
    findOne: ({ where }: { where: { id: string; tenantId: string } }): Promise<{ id: string } | null> =>
      where.id === "dev-a" && where.tenantId === (TENANT_A as string)
        ? Promise.resolve({ id: "dev-a" })
        : Promise.resolve(null),
  },
  Vendor: { findOne: (): Promise<null> => Promise.resolve(null) },
  User: { findOne: (): Promise<null> => Promise.resolve(null) },
  AuditLog: { create: (...args: unknown[]) => ledger().AuditLog.create(...args) },
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args: unknown[]) => ledger().transaction(...args) },
}));
jest.mock("../../services/webhook.service", () => ({ emitAfterCommit: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const maintenance = require("../../services/maintenance.service") as unknown as MaintenanceService;
const { logger } = require("../../middlewares/activityLog.middleware") as {
  logger: { error: (...args: unknown[]) => unknown };
};
/* eslint-enable @typescript-eslint/no-require-imports */

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

describe("W-30 -- a work order created by a job names the job", () => {
  it("with NO actor (what the scan passed before) the work order is rolled back", async () => {
    const err = (await maintenance.createWorkOrder(TENANT_A, SCAN_ORDER, {}).catch((e: unknown) => e)) as {
      status: number;
      message: string;
    };
    expect(err.status).toBe(500);
    expect(err.message).toContain("must name its actor");
    expect(ledger().committed("maintenance_work_orders")).toEqual([]);
    expect(ledger().auditRows()).toEqual([]);
  });

  it("with the system actor it commits the work order and ONE audit row naming the job", async () => {
    const result = await maintenance.createWorkOrder(TENANT_A, SCAN_ORDER, {
      systemActor: "system:calibration-scan",
    });

    expect(result.status).toBe(201);
    expect(ledger().committed("maintenance_work_orders")).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, deviceId: "dev-a", autoScheduled: true }),
    ]);
    const rows = ledger().auditRows();
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

describe("W-03 -- a second open auto-scheduled work order is a 409", () => {
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
    expect(ledger().auditRows()).toEqual([]);
  });
});
