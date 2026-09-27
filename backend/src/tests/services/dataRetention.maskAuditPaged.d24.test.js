/**
 * D-24 (ADR-083) — masking a data subject's audit trail read the subject's
 * WHOLE history in one statement (`AuditLog.findAll` with no limit): every row
 * they ever acted in, into memory at once.
 *
 * It now reads by keyset on id, 500 rows a page, inside the one transaction —
 * so the masking is still all or nothing — and finds the next page by id, not
 * offset: a masked row still matches the predicate. The SQL shape of the read
 * (real columns, the UPDATEs, no DELETE) stays pinned by
 * dataRetention.maskAudit.a135.test.js.
 */

const mockStore = { rows: [] };
const mockTx = { id: "tx-d24" };

jest.mock("../../models", () => ({
  IotReading: {},
  Notification: {},
  Session: {},
  TenantSettings: { findOne: jest.fn().mockResolvedValue(null) },
  AuditLog: {
    findAll: jest.fn(async ({ where, limit }) => {
      const { Op } = require("sequelize");
      const after = where.id ? where.id[Op.gt] : "";
      return mockStore.rows
        .filter((row) => row.id > after)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit);
    }),
  },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb(mockTx)) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Op } = require("sequelize");
const { AuditLog } = require("../../models");
const auditService = require("../../services/audit.service");
const dataRetention = require("../../services/dataRetention.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const ACTOR = { userId: "55555555-5555-4555-8555-555555555555" };

const auditRow = (n) => {
  const row = {
    id: `row-${String(n).padStart(5, "0")}`,
    userId: SUBJECT,
    impersonatorId: null,
    resourceType: "Device",
    resourceId: null,
    changes: null,
    ipAddress: "10.0.0.1",
    userAgent: "Firefox",
    update: jest.fn(async () => {}),
  };
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("D-24 (ADR-083) — maskPII('audit_logs') reads the subject's trail a page at a time", () => {
  it("masks all 1,201 rows through three keyset pages of at most 500, in one transaction, with one audit row", async () => {
    mockStore.rows = Array.from({ length: 1201 }, (_, i) => auditRow(i));

    const result = await dataRetention.maskPII(TENANT, "audit_logs", [SUBJECT], ACTOR);

    expect(result).toEqual({ masked: 1201, fields: ["ipAddress", "userAgent"] });
    const calls = AuditLog.findAll.mock.calls.map(([options]) => options);
    expect(calls).toHaveLength(3);
    for (const options of calls) {
      expect(options.limit).toBe(500);
      expect(options.order).toEqual([["id", "ASC"]]);
      expect(options.transaction).toBe(mockTx);
      expect(options.where.tenantId).toBe(TENANT);
    }
    expect(calls[0].where.id).toBeUndefined();
    expect(calls[1].where.id).toEqual({ [Op.gt]: "row-00499" });
    expect(calls[2].where.id).toEqual({ [Op.gt]: "row-00999" });
    expect(mockStore.rows.every((row) => row.update.mock.calls.length === 1)).toBe(true);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction.mock.calls[0][0].changes.rowsMasked).toBe(1201);
  });

  it("a trail of exactly one page ends on the empty page after it", async () => {
    mockStore.rows = Array.from({ length: 500 }, (_, i) => auditRow(i));
    const result = await dataRetention.maskPII(TENANT, "audit_logs", [SUBJECT], ACTOR);
    expect(result.masked).toBe(500);
    expect(AuditLog.findAll).toHaveBeenCalledTimes(2);
  });
});
