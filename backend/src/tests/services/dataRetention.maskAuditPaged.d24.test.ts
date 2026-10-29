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
import type * as SequelizeModule from "sequelize";

const mockStore: { rows: (Record<string, unknown> & { update: jest.Mock })[] } = { rows: [] };
const mockTx = { id: "tx-d24" };

jest.mock("../../models", () => ({
  IotReading: {},
  Notification: {},
  Session: {},
  TenantSettings: { findOne: jest.fn().mockResolvedValue(null) },
  AuditLog: {
    findAll: jest.fn(({ where, limit }: { where: Record<string, unknown>; limit: number }) => {
      const { Op } = jest.requireActual<typeof SequelizeModule>("sequelize");
      const after = (where["id"] as Record<symbol, string> | undefined)?.[Op.gt] ?? "";
      return Promise.resolve(
        mockStore.rows
          .filter((row) => (row["id"] as string) > after)
          .sort((a, b) => ((a["id"] as string) < (b["id"] as string) ? -1 : 1))
          .slice(0, limit),
      );
    }),
  },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockTx)) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const { Op } = require("sequelize") as typeof SequelizeModule;
const { AuditLog } = require("../../models") as { AuditLog: { findAll: jest.Mock } };
const auditService = require("../../services/audit.service") as { logAction: jest.Mock };
const dataRetention = require("../../services/dataRetention.service") as {
  maskPII: (
    tenantId: string,
    table: string,
    subjects: string[],
    actor: Record<string, unknown>,
  ) => Promise<{ masked: number; fields: string[] }>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const ACTOR = { userId: "55555555-5555-4555-8555-555555555555" };

const auditRow = (n: number) => {
  const row = {
    id: `row-${String(n).padStart(5, "0")}`,
    userId: SUBJECT,
    impersonatorId: null,
    resourceType: "Device",
    resourceId: null,
    changes: null,
    ipAddress: "10.0.0.1",
    userAgent: "Firefox",
    update: jest.fn(() => Promise.resolve()),
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
    const calls = AuditLog.findAll.mock.calls.map(([options]: [{ limit: number; order: unknown; transaction: unknown; where: Record<string, unknown> }]) => options);
    expect(calls).toHaveLength(3);
    for (const options of calls) {
      expect(options.limit).toBe(500);
      expect(options.order).toEqual([["id", "ASC"]]);
      expect(options.transaction).toBe(mockTx);
      expect(options.where["tenantId"]).toBe(TENANT);
    }
    expect(calls[0]?.where["id"]).toBeUndefined();
    expect(calls[1]?.where["id"]).toEqual({ [Op.gt]: "row-00499" });
    expect(calls[2]?.where["id"]).toEqual({ [Op.gt]: "row-00999" });
    expect(mockStore.rows.every((row) => row.update.mock.calls.length === 1)).toBe(true);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(
      (auditService.logAction.mock.calls[0] as [{ changes: { rowsMasked: number } }])[0].changes.rowsMasked,
    ).toBe(1201);
  });

  it("a trail of exactly one page ends on the empty page after it", async () => {
    mockStore.rows = Array.from({ length: 500 }, (_, i) => auditRow(i));
    const result = await dataRetention.maskPII(TENANT, "audit_logs", [SUBJECT], ACTOR);
    expect(result.masked).toBe(500);
    expect(AuditLog.findAll).toHaveBeenCalledTimes(2);
  });
});
