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

const mockState = { principal: null, rows: [], sql: [], audit: [], failAudit: null, noReqTenant: false };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockState.principal;
      req.tenantId = mockState.noReqTenant ? undefined : mockState.principal.tenantId;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// A write inside a transaction is applied at once and recorded for undo.
const mockApply = (row, values, options = {}) => {
  const tx = options.transaction;
  if (tx) {
    const prior = {};
    for (const key of Object.keys(values)) {
      prior[key] = row[key];
    }
    tx.undo.push([row, prior]);
  }
  Object.assign(row, values);
  return row;
};

jest.mock("../../models", () => ({
  CalibrationDevice: {
    findOne: jest.fn(async ({ where }) => {
      const row = mockState.rows.find((r) => r.id === where.id && r.tenantId === where.tenantId && !r.isDeleted);
      return row || null;
    }),
  },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: async (work) => {
      const tx = { undo: [] };
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
    query: jest.fn(async (sql, options) => {
      mockState.sql.push({ sql, bind: options.bind, type: options.type, transaction: options.transaction });
      return [{ set_config: options.bind[1] }];
    }),
  },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async (entry, options) => {
    if (mockState.failAudit) {
      throw mockState.failAudit;
    }
    mockState.audit.push({ entry, transaction: options.transaction });
    return {};
  }),
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const router = require("../../routes/api/calibrationDevices.route");

const http = (method, url, body = {}) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
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
    router.handle(req, res, (err) =>
      resolve({ status: err ? err.status || 500 : 404, body: { message: err ? err.message : "no route" } }),
    );
  });

const DEVICE_A = "d0000000-0000-4000-8000-00000000000a";
const DEVICE_B = "d0000000-0000-4000-8000-00000000000b";
const NO_SUCH_DEVICE = "d0000000-0000-4000-8000-0000000000ff";
const REASON = "Retired against the wrong asset tag during the stock take";

const deviceRow = (id, tenantId, status) => {
  const row = { id, tenantId, name: `Infusion pump ${id.slice(-1)}`, serialNumber: null, status, isDeleted: false };
  row.update = (values, options) => mockApply(row, values, options);
  row.toJSON = () => ({ id: row.id, tenantId: row.tenantId, name: row.name, status: row.status });
  return row;
};

describe("Q-02 (ADR-084): a retired device stays retired; reinstatement is the audited way back", () => {
  let fx;
  let adminA;

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
      expect(mockState.rows[0].status).toBe("retired");
      expect(mockState.audit).toEqual([]);
    });

    it("still edits a retired device's other fields", async () => {
      const res = await http("put", `/${DEVICE_A}`, { remarks: "Stored in the basement" });

      expect(res.status).toBe(200);
      expect(mockState.rows[0]).toMatchObject({ status: "retired", remarks: "Stored in the basement" });
    });
  });

  describe("POST /:id/reinstate", () => {
    it("reinstates with the reason, in one transaction with its audit row, after naming the device to the trigger", async () => {
      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "inactive" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, status: 200 });
      expect(mockState.rows[0].status).toBe("inactive");

      // set_config names THIS device, transaction-locally, in the audited transaction.
      expect(mockState.sql).toHaveLength(1);
      expect(mockState.sql[0].sql).toBe("SELECT set_config($1, $2, true)");
      expect(mockState.sql[0].bind).toEqual(["callibrator.reinstate_device", DEVICE_A]);
      expect(mockState.sql[0].type).toBe("SELECT");

      expect(mockState.audit).toHaveLength(1);
      const [{ entry, transaction }] = mockState.audit;
      expect(transaction).toBe(mockState.sql[0].transaction);
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
      expect(mockState.rows[1].status).toBe("retired");
      expect(mockState.audit).toEqual([]);
      expect(mockState.sql).toEqual([]);
    });

    it("if the audit row cannot be written, the device stays retired", async () => {
      mockState.failAudit = new Error("audit insert failed");

      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });

      expect(res.status).toBe(500);
      expect(mockState.rows[0].status).toBe("retired");
    });

    it("takes the tenant from the principal when the request carries none", async () => {
      mockState.noReqTenant = true;

      const own = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });
      const other = await http("post", `/${DEVICE_B}/reinstate`, { reason: REASON, status: "active" });

      expect(own.status).toBe(200);
      expect(other.status).toBe(404);
    });

    it("answers 409 for a device that is not retired", async () => {
      mockState.rows[0].status = "maintenance";

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
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(mockState.rows[0].status).toBe("retired");
    });

    it("answers 400 for a malformed id before any lookup", async () => {
      const res = await http("post", "/not-a-uuid/reinstate", { reason: REASON, status: "active" });

      expect(res.status).toBe(400);
    });

    it("refuses a technician (403): reinstatement is a tenant administrator's act", async () => {
      mockState.principal = fx.principal(fx.tenantA, "TECHNICIAN");

      const res = await http("post", `/${DEVICE_A}/reinstate`, { reason: REASON, status: "active" });

      expect(res.status).toBe(403);
      expect(mockState.rows[0].status).toBe("retired");
    });
  });
});
