/**
 * Q-02 (ADR-084) — a retired calibration device is permanently retired; the
 * one way back is an audited reinstatement.
 *
 * Through the REAL chain — calibrationDevices.route (validateUuid, rbac) →
 * calibrationDeviceReinstate.controller → calibrationDeviceReinstate.service,
 * and the real PUT /:id → calibrationDevices.controller →
 * calibrationDevices.service#updateCalibrationDevice — over principals from
 * the two-tenant fixture. Stubbed: `auth` (sets the principal), `dynamicAccess`
 * (the permission matrix is not what is under test), the model (rows keyed by
 * tenant, so a lookup honours the tenant predicate the service passes, as the
 * database would), and the database transaction, which applies writes at once
 * and UNDOES them on rollback, so a failed audit row leaves nothing behind.
 *
 * The database half of the rule — the 0089 trigger refusing the same UPDATE
 * from any path — is proven on PostgreSQL 18 in
 * calibrationDevice.retired.q02.live.test.js.
 */

import type { Request, Response, NextFunction } from "express";

interface MockTx {
  undo: [MockDeviceRow, Record<string, unknown>][];
}

interface MockDeviceRow {
  id: string;
  tenantId: string;
  name: string;
  serialNumber: string | null;
  status: string;
  isDeleted: boolean;
  remarks?: string;
  update?: (values: Record<string, unknown>, options?: { transaction?: MockTx }) => MockDeviceRow;
  toJSON?: () => Record<string, unknown>;
}

interface MockState {
  principal: { tenantId: string; id: string; role?: { name: string } } | null;
  rows: MockDeviceRow[];
  sql: { sql: string; bind: unknown[]; type: string; transaction: unknown }[];
  audit: { entry: Record<string, unknown>; transaction: unknown }[];
  failAudit: Error | null;
  noReqTenant: boolean;
}

const mockState: MockState = { principal: null, rows: [], sql: [], audit: [], failAudit: null, noReqTenant: false };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      const r = req as unknown as { user: unknown; tenantId?: unknown };
      r.user = mockState.principal;
      r.tenantId = mockState.noReqTenant ? undefined : mockState.principal?.tenantId;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// A write inside a transaction is applied at once and recorded for undo.
const mockApply = (row: MockDeviceRow, values: Record<string, unknown>, options: { transaction?: MockTx } = {}) => {
  const tx = options.transaction;
  if (tx) {
    const prior: Record<string, unknown> = {};
    for (const key of Object.keys(values)) {
      prior[key] = (row as unknown as Record<string, unknown>)[key];
    }
    tx.undo.push([row, prior]);
  }
  Object.assign(row, values);
  return row;
};

jest.mock("../../models", () => ({
  CalibrationDevice: {
    findOne: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
      const row = mockState.rows.find((r) => r.id === where.id && r.tenantId === where.tenantId && !r.isDeleted);
      return row || null;
    }),
  },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: async (work: (tx: MockTx) => Promise<unknown>) => {
      const tx: MockTx = { undo: [] };
      try {
        return await work(tx);
      } catch (error) {
        for (const [row, prior] of tx.undo.reverse()) {
          Object.assign(row, prior);
        }
        throw error;
      }
    },
    // P9-07: the service runs this through sql() — bind parameters, type SELECT.
    query: jest.fn(async (sql: string, options: { bind: unknown[]; type: string; transaction: unknown }) => {
      mockState.sql.push({ sql, bind: options.bind, type: options.type, transaction: options.transaction });
      return [{ set_config: options.bind[1] }];
    }),
  },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async (entry: any, options: { transaction?: unknown } = {}) => {
    if (mockState.failAudit) {
      throw mockState.failAudit;
    }
    mockState.audit.push({ entry, transaction: options.transaction });
    return {};
  }),
}));

const { createTwoTenants } = require("../fixtures/twoTenants") as { createTwoTenants: () => ReturnType<typeof import("../fixtures/twoTenants").createTwoTenants> };
const router = require("../../routes/api/calibrationDevices.route") as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; message?: string }) => void) => void };

interface HttpResponse {
  status: number;
  body: {
    message?: string;
    success?: boolean;
    status?: number;
    data?: unknown;
    errors?: unknown[];
  };
}

const http = (method: string, url: string, body: Record<string, unknown> = {}): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: HttpResponse["body"]) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: HttpResponse["body"]) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/calibration-devices" + url,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest" },
      ip: "127.0.0.1",
      get: () => undefined,
    };
    (router as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; message?: string }) => void) => void }).handle(req, res, (err?: { status?: number; message?: string }) =>
      resolve({ status: err ? err.status || 500 : 404, body: { message: err?.message ?? "no route" } }),
    );
  });

const DEVICE_A = "d0000000-0000-4000-8000-00000000000a";
const DEVICE_B = "d0000000-0000-4000-8000-00000000000b";
const NO_SUCH_DEVICE = "d0000000-0000-4000-8000-0000000000ff";
const REASON = "Retired against the wrong asset tag during the stock take";

const deviceRow = (id: string, tenantId: string, status: string): MockDeviceRow => {
  const row: MockDeviceRow = { id, tenantId, name: `Infusion pump ${id.slice(-1)}`, serialNumber: null, status, isDeleted: false };
  row.update = (values, options) => mockApply(row, values, options);
  row.toJSON = () => ({ id: row.id, tenantId: row.tenantId, name: row.name, status: row.status });
  return row;
};

describe("Q-02 (ADR-084): a retired device stays retired; reinstatement is the audited way back", () => {
  let fx: ReturnType<typeof createTwoTenants>;
  let adminA: ReturnType<typeof fx.principal>;

  beforeEach(() => {
    jest.clearAllMocks();
    fx = createTwoTenants();
    adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
    mockState.principal = adminA;
    mockState.rows = [deviceRow(DEVICE_A, fx.tenantA.id, "retired"), deviceRow(DEVICE_B, fx.tenantB.id, "retired")];
    mockState.sql = [];
    mockState.audit = [];
    mockState.failAudit = null;
    mockState.noReqTenant = false;
  });

  describe("PUT /:id — the edit path cannot undo a retirement", () => {
    it("answers 409 with a state explanation, and writes nothing", async () => {
      const res = await http("put", `/${DEVICE_A}`, { status: "active" });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, status: 409, data: null });
      expect(res.body.message).toMatch(/is retired, and retirement is permanent/);
      expect(res.body.message).toMatch(/reinstate it with a reason/);
      expect((mockState.rows[0] as MockDeviceRow).status).toBe("retired");
      expect(mockState.audit).toEqual([]);
    });

    it("still edits a retired device's other fields", async () => {
      const res = await http("put", `/${DEVICE_A}`, { remarks: "Stored in the basement" });

      expect(res.status).toBe(200);
      expect(mockState.rows[0] as MockDeviceRow).toMatchObject({ status: "retired", remarks: "Stored in the basement" });
    });
  });

  describe("POST /:id/reinstate", () => {
    it("reinstates with the reason, in one transaction with its audit row, after naming the device to the trigger", async () => {
      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "inactive" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, status: 200 });
      expect((mockState.rows[0] as MockDeviceRow).status).toBe("inactive");

      // set_config names THIS device, transaction-locally, in the audited transaction.
      expect(mockState.sql).toHaveLength(1);
      const sql0 = mockState.sql[0] as { sql: string; bind: unknown[]; type: string; transaction: unknown };
      expect(sql0.sql).toBe("SELECT set_config($1, $2, true)");
      expect(sql0.bind).toEqual(["callibrator.reinstate_device", DEVICE_A]);
      expect(sql0.type).toBe("SELECT");

      expect(mockState.audit).toHaveLength(1);
      const audit0 = mockState.audit[0] as { entry: Record<string, unknown>; transaction: unknown };
      const { entry, transaction } = audit0;
      expect(transaction).toBe(sql0.transaction);
      expect(entry).toMatchObject({
        tenantId: fx.tenantA.id,
        userId: adminA.id,
        action: "UPDATE",
        resourceType: "CalibrationDevice",
        resourceId: DEVICE_A,
        changes: {
          operation: "REINSTATE",
          reason: REASON,
          before: { status: "retired" },
          after: { status: "inactive" },
        },
      });
    });

    it("another tenant's device answers 404 — exactly as a device that does not exist — and is untouched", async () => {
      const other = await http("post", `/${DEVICE_B}/reinstate`, { reason: REASON, status: "active" });
      const missing = await http("post", `/${NO_SUCH_DEVICE}/reinstate`, { reason: REASON, status: "active" });

      expect(other.status).toBe(404);
      expect(other).toEqual(missing);
      expect((mockState.rows[1] as MockDeviceRow).status).toBe("retired");
      expect(mockState.audit).toEqual([]);
      expect(mockState.sql).toEqual([]);
    });

    it("if the audit row cannot be written, the device stays retired", async () => {
      mockState.failAudit = new Error("audit insert failed");

      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });

      expect(res.status).toBe(500);
      expect((mockState.rows[0] as MockDeviceRow).status).toBe("retired");
    });

    it("takes the tenant from the principal when the request carries none", async () => {
      mockState.noReqTenant = true;

      const own = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });
      const other = await http("post", `/${DEVICE_B}/reinstate`, { reason: REASON, status: "active" });

      expect(own.status).toBe(200);
      expect(other.status).toBe(404);
    });

    it("answers 409 for a device that is not retired", async () => {
      (mockState.rows[0] as MockDeviceRow).status = "maintenance";

      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/is not retired \(its status is "maintenance"\)/);
      expect(mockState.audit).toEqual([]);
    });

    it.each([
      ["no reason", { status: "active" }],
      ["a reason too short to explain anything", { reason: "oops", status: "active" }],
      ["no status to return to", { reason: REASON }],
      ["retired as the status to return to", { reason: REASON, status: "retired" }],
    ])("answers 400 for %s", async (_label, body) => {
      const res = await http("post", `/${DEVICE_A}/reinstate`, body);

      expect(res.status).toBe(400);
      expect(((res.body as { errors?: unknown[] }).errors ?? []).length).toBeGreaterThan(0);
      expect((mockState.rows[0] as MockDeviceRow).status).toBe("retired");
    });

    it("answers 400 for a malformed id before any lookup", async () => {
      const res = await http("post", "/not-a-uuid/reinstate", { reason: REASON, status: "active" });

      expect(res.status).toBe(400);
    });

    it("refuses a technician (403): reinstatement is a tenant administrator's act", async () => {
      mockState.principal = fx.principal(fx.tenantA, "TECHNICIAN");

      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });

      expect(res.status).toBe(403);
      expect((mockState.rows[0] as MockDeviceRow).status).toBe("retired");
    });
  });
});
