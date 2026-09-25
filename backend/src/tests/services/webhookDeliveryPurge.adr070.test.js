/**
 * ADR-070 — webhook_deliveries had no purge (the open item of ADR-064 #4).
 *
 * The purge removes only FINISHED rows (success, exhausted) older than the
 * retention window (30 days default, never below 7), per tenant in the
 * tenant's context, a bounded batch per transaction with its audit row in the
 * same transaction, and stops at a per-run bound. A pending or failed row —
 * live queue state — is never selected or deleted.
 *
 * The statements are proven against PostgreSQL 18 in dataLayer.dbC.live.test.js.
 */

const { Op } = require("sequelize");

const mockStore = { tenants: [], deliveries: [] };

jest.mock("../../models", () => ({
  Tenant: { findAll: jest.fn(async () => mockStore.tenants.map((id) => ({ id }))) },
  WebhookDelivery: {
    findAll: jest.fn(async ({ where, limit }) => {
      const { Op: SOp } = require("sequelize");
      return mockStore.deliveries
        .filter(
          (d) =>
            d.tenantId === where.tenantId &&
            where.status.includes(d.status) &&
            d.updatedAt < where.updatedAt[SOp.lt],
        )
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, limit)
        .map((d) => ({ id: d.id, status: d.status }));
    }),
    destroy: jest.fn(async ({ where }) => {
      const before = mockStore.deliveries.length;
      mockStore.deliveries = mockStore.deliveries.filter(
        (d) => !(where.id.includes(d.id) && d.tenantId === where.tenantId && where.status.includes(d.status)),
      );
      return before - mockStore.deliveries.length;
    }),
  },
}));

jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("TX")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../utils/jobContext.util", () => ({ runForTenant: jest.fn(async (tenantId, fn) => fn()) }));

const { Tenant, WebhookDelivery } = require("../../models");
const auditService = require("../../services/audit.service");
const { runForTenant } = require("../../utils/jobContext.util");
const { SYSTEM_ACTORS } = require("../../constants/systemActors");
const purge = require("../../services/webhookDeliveryPurge.service");

const NOW = new Date("2026-09-25T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

let seq = 0;
const delivery = (tenantId, status, ageDays) => ({
  id: `d-${++seq}`,
  tenantId,
  status,
  updatedAt: daysAgo(ageDays),
});

const ENV = [
  "WEBHOOK_DELIVERY_RETENTION_DAYS",
  "WEBHOOK_DELIVERY_PURGE_BATCH",
  "WEBHOOK_DELIVERY_PURGE_MAX_ROWS",
];

beforeEach(() => {
  jest.clearAllMocks();
  for (const name of ENV) {
    delete process.env[name];
  }
  mockStore.tenants = ["tenant-a", "tenant-b"];
  mockStore.deliveries = [];
});

describe("ADR-070 — retention window", () => {
  it("defaults to 30 days, honours the variable, and never goes below 7", () => {
    expect(purge.retentionDays()).toBe(30);
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = "90";
    expect(purge.retentionDays()).toBe(90);
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = "2";
    expect(purge.retentionDays()).toBe(7);
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = "nonsense";
    expect(purge.retentionDays()).toBe(30);
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = "-5";
    expect(purge.retentionDays()).toBe(30);
  });
});

describe("ADR-070 — purgeFinishedDeliveries", () => {
  it("removes finished rows past the window and nothing else — never a pending or failed row, however old", async () => {
    const keep = [
      delivery("tenant-a", "pending", 400),
      delivery("tenant-a", "failed", 400),
      delivery("tenant-a", "success", 29),
      delivery("tenant-a", "exhausted", 10),
    ];
    mockStore.deliveries = [
      ...keep,
      delivery("tenant-a", "success", 31),
      delivery("tenant-a", "exhausted", 45),
      delivery("tenant-b", "success", 200),
    ];

    const summary = await purge.purgeFinishedDeliveries({ now: NOW });

    expect(summary).toEqual({
      tenants: 2,
      deleted: 3,
      retentionDays: 30,
      cutoff: daysAgo(30).toISOString(),
      stoppedEarly: false,
    });
    expect(mockStore.deliveries.map((d) => d.id)).toEqual(keep.map((d) => d.id));

    // The read and the delete are both confined to finished statuses.
    for (const [{ where }] of WebhookDelivery.findAll.mock.calls) {
      expect(where.status).toEqual(["success", "exhausted"]);
      expect(where.updatedAt[Op.lt]).toEqual(daysAgo(30));
    }
    for (const [{ where, transaction }] of WebhookDelivery.destroy.mock.calls) {
      expect(where.status).toEqual(["success", "exhausted"]);
      expect(transaction).toBe("TX");
    }
  });

  it("works per tenant, in that tenant's context, with one audit row per batch in the batch's transaction", async () => {
    mockStore.deliveries = [
      delivery("tenant-a", "success", 40),
      delivery("tenant-a", "exhausted", 50),
      delivery("tenant-b", "success", 60),
    ];

    await purge.purgeFinishedDeliveries({ now: NOW });

    expect(runForTenant.mock.calls.map(([tenantId]) => tenantId)).toEqual(["tenant-a", "tenant-b"]);
    expect(Tenant.findAll).toHaveBeenCalledWith({ attributes: ["id"], order: [["id", "ASC"]], paranoid: false });
    expect(auditService.logAction).toHaveBeenCalledTimes(2);
    expect(auditService.logAction).toHaveBeenNthCalledWith(
      1,
      {
        tenantId: "tenant-a",
        systemActor: SYSTEM_ACTORS.WEBHOOK_DELIVERY_PURGE,
        action: "DELETE",
        resourceType: "WebhookDelivery",
        resourceId: null,
        changes: {
          operation: "purge",
          deleted: 2,
          byStatus: { exhausted: 1, success: 1 },
          olderThan: daysAgo(30).toISOString(),
          retentionDays: 30,
        },
      },
      { transaction: "TX" },
    );
    expect(auditService.logAction.mock.calls[1][0].tenantId).toBe("tenant-b");
  });

  it("a tenant with nothing to purge writes no audit row", async () => {
    mockStore.deliveries = [delivery("tenant-a", "success", 1)];

    const summary = await purge.purgeFinishedDeliveries({ now: NOW });

    expect(summary.deleted).toBe(0);
    expect(WebhookDelivery.destroy).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("deletes a batch per statement and stops at the per-run bound, saying so", async () => {
    process.env.WEBHOOK_DELIVERY_PURGE_BATCH = "2";
    process.env.WEBHOOK_DELIVERY_PURGE_MAX_ROWS = "5";
    mockStore.deliveries = [
      ...Array.from({ length: 4 }, (_, i) => delivery("tenant-a", "success", 40 + i)),
      ...Array.from({ length: 4 }, (_, i) => delivery("tenant-b", "exhausted", 40 + i)),
    ];

    const summary = await purge.purgeFinishedDeliveries({ now: NOW });

    expect(summary.deleted).toBe(5);
    expect(summary.stoppedEarly).toBe(true);
    expect(mockStore.deliveries).toHaveLength(3);
    // tenant-a: 2 + 2, then an empty read within the remaining budget of 1;
    // tenant-b: the remaining budget of 1.
    expect(WebhookDelivery.findAll.mock.calls.map(([o]) => [o.where.tenantId, o.limit])).toEqual([
      ["tenant-a", 2],
      ["tenant-a", 2],
      ["tenant-a", 1],
      ["tenant-b", 1],
    ]);
    expect(auditService.logAction).toHaveBeenCalledTimes(3);
  });

  it("does not start another tenant once the bound is reached", async () => {
    process.env.WEBHOOK_DELIVERY_PURGE_MAX_ROWS = "1";
    mockStore.deliveries = [delivery("tenant-a", "success", 40), delivery("tenant-b", "success", 40)];

    const summary = await purge.purgeFinishedDeliveries({ now: NOW });

    expect(summary).toMatchObject({ deleted: 1, stoppedEarly: true });
    expect(runForTenant).toHaveBeenCalledTimes(1);
  });

  it("a failing audit row rejects the run, so that batch's delete rolls back with it", async () => {
    mockStore.deliveries = [delivery("tenant-a", "success", 40)];
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(purge.purgeFinishedDeliveries({ now: NOW })).rejects.toThrow("audit insert failed");
  });

  it("uses the current time when none is given", async () => {
    const summary = await purge.purgeFinishedDeliveries();
    expect(Date.now() - new Date(summary.cutoff).getTime()).toBeGreaterThanOrEqual(30 * DAY - 1000);
  });
});
