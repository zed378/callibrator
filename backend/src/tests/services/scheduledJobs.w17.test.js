/**
 * W-12 / W-17 — every scheduled job declares its tenant context and reads a
 * bounded amount per statement.
 *
 *  - retention: tenants in keyset pages; each tenant purged inside
 *    runForTenant(tenant); a table that fills its batch gets another pass
 *    (another transaction, another audit row) until done or out of time;
 *  - session cleanup: bounded DELETE batches under the named platform
 *    context, stopping on a short batch or when the budget is spent;
 *  - tenant lifecycle and scheduled backup: tenants in keyset pages; the
 *    backup prune walks (tenant, created_at DESC, id DESC) pages carrying the
 *    tenant's rank across a page boundary;
 *  - webhook dispatch: the claim is the named system task, each delivery runs
 *    in its own tenant.
 *
 * The SQL these become is proven on PostgreSQL 18 by
 * backgroundJobs.w12.live.test.js.
 */
const { Op } = require("sequelize");

jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")), query: jest.fn() },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/tenantBackup.service", () => ({
  BACKUP_DIR: require("path").join(require("os").tmpdir(), "w17-scheduled-jobs", "backups"),
  createBackup: jest.fn(),
}));
jest.mock("../../models", () => ({
  Notification: { destroy: jest.fn() },
  Session: { destroy: jest.fn() },
  Sessions: { destroy: jest.fn() },
  IotReading: { destroy: jest.fn() },
  Tenant: { findAll: jest.fn(), findByPk: jest.fn() },
  TenantSettings: { findAll: jest.fn(), findOne: jest.fn() },
  TenantBackup: {
    STATUS: { COMPLETED: "completed", DELETED: "deleted" },
    DEFAULT_RETENTION_DAYS: 30,
    findAll: jest.fn(),
  },
  Webhook: { findOne: jest.fn() },
  WebhookDelivery: { findOne: jest.fn() },
  AuditLog: { create: jest.fn() },
  User: {},
  Subscription: {},
  Invoice: {},
}));

const models = require("../../models");
const { db } = require("../../config");
const auditService = require("../../services/audit.service");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { SYSTEM_TASKS } = require("../../utils/jobContext.util");

const TENANT_CONTEXT = (tenantId) => ({ tenantId, isSuperAdmin: false, isSystemTask: false });

beforeEach(() => {
  jest.clearAllMocks();
  models.TenantSettings.findAll.mockResolvedValue([]);
  models.TenantSettings.findOne.mockResolvedValue(null);
  models.Notification.destroy.mockResolvedValue(0);
  models.Session.destroy.mockResolvedValue(0);
  models.IotReading.destroy.mockResolvedValue(0);
});

describe("retention purge (W-12, W-17)", () => {
  const retention = require("../../services/dataRetention.service");

  it("a table that fills its batch gets another pass, each pass one transaction and one audit row", async () => {
    models.Notification.destroy.mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    models.Session.destroy.mockResolvedValueOnce(1);

    const result = await retention.purgeExpiredRecords("t1", { batchSize: 2 });

    expect(result).toEqual({
      tenantId: "t1",
      purged: { notifications: 5, sessions: 1 },
      skipped: false,
      complete: true,
    });
    expect(db.transaction).toHaveBeenCalledTimes(3);
    // Every destroy is bounded.
    for (const [opts] of models.Notification.destroy.mock.calls) {
      expect(opts).toMatchObject({ limit: 2, transaction: "TX" });
    }
    // Pass 2 and 3 revisit only the table that filled its batch.
    expect(models.Session.destroy).toHaveBeenCalledTimes(1);
    expect(auditService.logAction.mock.calls.map(([e]) => [e.changes.after.purged, e.changes.batch])).toEqual([
      [{ notifications: 2, sessions: 1 }, { size: 2, full: ["notifications"] }],
      [{ notifications: 2 }, { size: 2, full: ["notifications"] }],
      [{ notifications: 1 }, { size: 2, full: [] }],
    ]);
  });

  it("stops starting passes once the deadline has passed, and says the tenant is incomplete", async () => {
    models.Notification.destroy.mockResolvedValue(2);

    const result = await retention.purgeExpiredRecords("t1", { batchSize: 2, deadline: Date.now() - 1 });

    expect(result).toMatchObject({ purged: { notifications: 2 }, complete: false });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("a tenant whose every period is 'keep forever' opens no transaction", async () => {
    models.TenantSettings.findAll.mockResolvedValue([
      { key: "retention_policy_notifications", value: "0" },
      { key: "retention_policy_sessions", value: "0" },
    ]);

    const result = await retention.purgeExpiredRecords("t1");

    expect(result).toEqual({ tenantId: "t1", purged: {}, skipped: false, complete: true });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("the sweep reads tenants in keyset pages and purges each inside ITS OWN tenant context", async () => {
    models.Tenant.findAll
      .mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }])
      .mockResolvedValueOnce([{ id: "t3" }]);
    const contexts = [];
    models.Notification.destroy.mockImplementation(async () => {
      contexts.push(tenantStorage.getStore());
      return 0;
    });

    const summary = await retention.runRetentionSweep({ pageSize: 2 });

    expect(summary).toEqual({ tenants: 3, purged: 0, skipped: 0, errors: 0, incomplete: 0 });
    const [first, second] = models.Tenant.findAll.mock.calls.map(([opts]) => opts);
    expect(first).toMatchObject({ where: {}, limit: 2, order: [["id", "ASC"]] });
    expect(second.where).toEqual({ id: { [Op.gt]: "t2" } });
    expect(contexts).toEqual([TENANT_CONTEXT("t1"), TENANT_CONTEXT("t2"), TENANT_CONTEXT("t3")]);
  });

  it("the sweep counts a tenant left with rows as incomplete", async () => {
    models.Tenant.findAll.mockResolvedValueOnce([{ id: "t1" }]);
    models.Notification.destroy.mockResolvedValue(3);

    const summary = await retention.runRetentionSweep({ batchSize: 3, budgetMs: -1 });

    expect(summary).toEqual({ tenants: 1, purged: 3, skipped: 0, errors: 0, incomplete: 1 });
  });
});

describe("session cleanup (W-12, W-17)", () => {
  const session = require("../../services/session.service");

  it("deletes in bounded batches until a batch comes back short", async () => {
    models.Sessions.destroy.mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const now = new Date("2026-09-25T00:00:00Z");

    await expect(session.cleanupExpiredSessions({ now, batchSize: 2 })).resolves.toBe(5);

    expect(models.Sessions.destroy).toHaveBeenCalledTimes(3);
    expect(models.Sessions.destroy).toHaveBeenCalledWith({ where: { expired_at: { [Op.lt]: now } }, limit: 2 });
  });

  it("stops after the batch in hand once its time budget is spent", async () => {
    models.Sessions.destroy.mockResolvedValue(2);

    await expect(session.cleanupExpiredSessions({ batchSize: 2, budgetMs: -1 })).resolves.toBe(2);
    expect(models.Sessions.destroy).toHaveBeenCalledTimes(1);
  });

  it("runs as the named platform task, never in a tenant and never as a super admin", async () => {
    let seen;
    models.Sessions.destroy.mockImplementation(async () => {
      seen = tenantStorage.getStore();
      return 0;
    });

    await session.cleanupExpiredSessions();

    expect(seen).toEqual({
      tenantId: null,
      isSuperAdmin: false,
      isSystemTask: true,
      systemReason: SYSTEM_TASKS.SESSION_CLEANUP,
    });
  });
});

describe("tenant lifecycle processor (W-17)", () => {
  const lifecycle = require("../../services/tenantLifecycle.service");

  it("reads expired tenants in keyset pages of ids, and offboards each in its own tenant", async () => {
    models.Tenant.findAll.mockResolvedValueOnce([{ id: "t1" }]).mockResolvedValueOnce([]);
    const contexts = [];
    const offboard = jest.spyOn(lifecycle, "offboardTenant").mockImplementation(async () => {
      contexts.push(tenantStorage.getStore());
    });

    const results = await lifecycle.processExpiredGracePeriods({ pageSize: 1 });

    expect(results).toEqual([{ tenantId: "t1", action: "offboarded" }]);
    const [first, second] = models.Tenant.findAll.mock.calls.map(([opts]) => opts);
    expect(first).toMatchObject({ attributes: ["id"], limit: 1, order: [["id", "ASC"]] });
    expect(first.where.id).toBeUndefined();
    expect(second.where.id).toEqual({ [Op.gt]: "t1" });
    expect(contexts).toEqual([TENANT_CONTEXT("t1")]);
    offboard.mockRestore();
  });
});

describe("scheduled backup (W-17)", () => {
  const backup = require("../../services/scheduledBackup.service");
  afterAll(() => {
    const { BACKUP_DIR } = require("../../services/tenantBackup.service");
    require("fs").rmSync(require("path").dirname(BACKUP_DIR), { recursive: true, force: true });
  });
  const NOW = new Date("2026-09-25T00:00:00Z");
  const row = (id, tenantId, createdAt) => ({
    id,
    tenantId,
    createdAt,
    status: "completed",
    retentionDays: 1,
    expiresAt: new Date("2026-01-01T00:00:00Z"),
    update: jest.fn(),
    destroy: jest.fn(),
  });

  it("the tenant list is read in keyset pages", async () => {
    models.Tenant.findAll.mockResolvedValueOnce([{ id: "t1" }]).mockResolvedValueOnce([]);
    models.TenantBackup.findAll.mockResolvedValue([]);
    process.env.BACKUP_PRUNE_PAGE_SIZE = "1";
    require("../../services/tenantBackup.service").createBackup.mockRejectedValue(new Error("no disk"));
    jest.spyOn(process.stderr, "write").mockImplementation(() => true); // the run is reported failed, on purpose

    const out = await backup.runScheduledBackup({ now: NOW });

    delete process.env.BACKUP_PRUNE_PAGE_SIZE;
    expect(out.tenants).toBe(1);
    expect(models.Tenant.findAll.mock.calls[1][0].where.id).toEqual({ [Op.gt]: "t1" });
  });

  it("the prune carries a tenant's rank across a page boundary and pages on the composite key", async () => {
    const a1 = row("a1", "A", new Date("2026-01-03"));
    const a2 = row("a2", "A", new Date("2026-01-02"));
    const a3 = row("a3", "A", new Date("2026-01-01"));
    const b1 = row("b1", "B", new Date("2026-01-05"));
    models.TenantBackup.findAll.mockResolvedValueOnce([a1, a2]).mockResolvedValueOnce([a3, b1]).mockResolvedValueOnce([]);

    const out = await backup.pruneExpiredBackups({ now: NOW, keepMin: 2, pageSize: 2 });

    // A keeps its newest two (a1 on page 1, a2 too); a3 on page 2 is rank 3.
    expect(out.pruned).toEqual([{ tenantId: "A", backupId: "a3" }]);
    expect(out.kept).toBe(3);
    const second = models.TenantBackup.findAll.mock.calls[1][0];
    expect(second.limit).toBe(2);
    expect(second.where[Op.or]).toEqual([
      { tenantId: { [Op.gt]: "A" } },
      { tenantId: "A", createdAt: { [Op.lt]: a2.createdAt } },
      { tenantId: "A", createdAt: a2.createdAt, id: { [Op.lt]: "a2" } },
    ]);
    expect(models.TenantBackup.findAll.mock.calls[2][0].where[Op.or][0]).toEqual({ tenantId: { [Op.gt]: "B" } });
  });
});

describe("webhook dispatcher (W-12)", () => {
  const webhook = require("../../services/webhook.service");

  it("claims as the named system task and delivers each row in its own tenant", async () => {
    let claimContext;
    db.query.mockImplementation(async () => {
      claimContext = tenantStorage.getStore();
      return [[{ id: "d1", tenantId: "t1" }, { id: "d2", tenantId: "t2" }]];
    });
    const seen = [];
    models.WebhookDelivery.findOne.mockImplementation(async () => {
      seen.push(tenantStorage.getStore());
      return null; // gone: nothing to send
    });

    await expect(webhook.dispatchDue()).resolves.toEqual({ claimed: 2, errors: 0 });

    expect(claimContext).toMatchObject({ isSystemTask: true, systemReason: SYSTEM_TASKS.WEBHOOK_DISPATCH });
    expect(seen).toEqual([TENANT_CONTEXT("t1"), TENANT_CONTEXT("t2")]);
  });
});
