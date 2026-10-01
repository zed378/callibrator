/**
 * P8-04 (ADR-096) — the query-shaped fixes, as unit guards.
 *
 *  1. Audit list: the count is BOUNDED (at most AUDIT_COUNT_CAP + 1 rows are
 *     counted, and `meta.totalIsCapped` says when the total is a lower bound),
 *     it runs through utils/sql.util with the tenant BOUND as $1, and a request
 *     with no dates and no resource reads the default window.
 *  2. Dashboard: at most DASHBOARD_CONCURRENCY of its aggregate queries hold
 *     a connection at once (they were one Promise.all of 20 against a pool of 20).
 *  3. Kanban N+1s: listProjects and listSprints issue a CONSTANT number of
 *     queries — the per-board count + resolveAccess and the per-sprint count
 *     are gone. Counted as model calls here; counted as SQL statements on
 *     PostgreSQL 18 by queryCount.p804.live.test.ts.
 *
 * Each guard failed on the tree before the fix (ADR-096, "Fail-before").
 */

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS services, loaded per test with jest.isolateModules after their mocks */

type Fn = jest.Mock;
type AnyRecord = Record<string, unknown>;

/** The arguments of call `i` of a mock (jest types them `any`). */
const args = (fn: Fn, i = 0): unknown[] => (fn.mock.calls as unknown[][])[i] ?? [];

// ------------------------------------------------------------------
// 1. Audit list
// ------------------------------------------------------------------
describe("P8-04 audit list — bounded count and default window", () => {
  const TENANT = "a0000000-0000-4000-8000-00000000000a";
  let findAll: Fn;
  let sql: Fn;
  let svc: {
    fetchAuditLogs: (q: AnyRecord) => Promise<{ data: { rows: unknown[]; meta: AnyRecord } }>;
    AUDIT_COUNT_CAP: number;
    AUDIT_DEFAULT_WINDOW_DAYS: number;
  };

  beforeEach(() => {
    jest.resetModules();
    findAll = jest.fn().mockResolvedValue([]);
    sql = jest.fn().mockResolvedValue([{ n: 0 }]);
    jest.doMock("../../models", () => ({ AuditLog: { findAll, create: jest.fn() }, User: {}, sequelize: { tag: "db" } }));
    jest.doMock("../../utils/sql.util", () => ({ sql }));
    svc = require("../../services/audit.service") as typeof svc;
  });

  it("counts through sql() with the tenant bound as $1 and at most CAP + 1 rows", async () => {
    await svc.fetchAuditLogs({ tenantId: TENANT, userId: "u-1", action: "DELETE" });

    expect(sql).toHaveBeenCalledTimes(1);
    const [runner, text, bind] = args(sql) as [AnyRecord, string, unknown[]];
    expect(runner).toEqual({ tag: "db" });
    expect(text).toMatch(/WHERE tenant_id = \$1\b/);
    expect(text).toMatch(/LIMIT \$9\)/);
    expect(bind[0]).toBe(TENANT);
    expect(bind[1]).toBe("u-1");
    expect(bind[3]).toBe("DELETE");
    expect(bind[8]).toBe(svc.AUDIT_COUNT_CAP + 1);
  });

  it("in a tenant principal's context the count binds the tenant the hook forces, not the one asked for", async () => {
    const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as {
      tenantStorage: { run<T>(ctx: object, fn: () => Promise<T>): Promise<T> };
    };
    const { NO_TENANT_UUID } = require("../../utils/tenantScope.util") as { NO_TENANT_UUID: string };
    const OWN = "b0000000-0000-4000-8000-00000000000b";

    await tenantStorage.run({ tenantId: OWN, isSuperAdmin: false, isSystemTask: false }, () =>
      svc.fetchAuditLogs({ tenantId: TENANT }),
    );
    await tenantStorage.run({ tenantId: null, isSuperAdmin: false, isSystemTask: false }, () =>
      svc.fetchAuditLogs({ tenantId: TENANT }),
    );
    await tenantStorage.run({ tenantId: OWN, isSuperAdmin: true, isSystemTask: false }, () =>
      svc.fetchAuditLogs({ tenantId: TENANT }),
    );

    expect([0, 1, 2].map((i) => (args(sql, i)[2] as unknown[])[0])).toEqual([OWN, NO_TENANT_UUID, TENANT]);
  });

  it("never runs an unbounded count (findAndCountAll / count)", async () => {
    const models = require("../../models") as { AuditLog: AnyRecord };
    models.AuditLog["findAndCountAll"] = jest.fn();
    models.AuditLog["count"] = jest.fn();

    await svc.fetchAuditLogs({ tenantId: TENANT });

    expect(models.AuditLog["findAndCountAll"]).not.toHaveBeenCalled();
    expect(models.AuditLog["count"]).not.toHaveBeenCalled();
    expect(findAll).toHaveBeenCalledTimes(1);
  });

  it("reports a count past the cap as the cap, flagged as a lower bound", async () => {
    sql.mockResolvedValueOnce([{ n: svc.AUDIT_COUNT_CAP + 1 }]);

    const { data } = await svc.fetchAuditLogs({ tenantId: TENANT, limit: 25 });

    expect(data.meta["total"]).toBe(svc.AUDIT_COUNT_CAP);
    expect(data.meta["totalIsCapped"]).toBe(true);
    expect(data.meta["totalPages"]).toBe(Math.ceil(svc.AUDIT_COUNT_CAP / 25));
  });

  it("reports an exact count under the cap as exact", async () => {
    sql.mockResolvedValueOnce([{ n: 42 }]);

    const { data } = await svc.fetchAuditLogs({ tenantId: TENANT });

    expect(data.meta["total"]).toBe(42);
    expect(data.meta["totalIsCapped"]).toBe(false);
  });

  it("with no date and no resource, rows and count both read the default window", async () => {
    const before = Date.now();

    const { data } = await svc.fetchAuditLogs({ tenantId: TENANT });

    const bind = args(sql)[2] as unknown[];
    const from = bind[6] as Date;
    const windowMs = svc.AUDIT_DEFAULT_WINDOW_DAYS * 86_400_000;
    expect(from.getTime()).toBeGreaterThanOrEqual(before - windowMs);
    expect(from.getTime()).toBeLessThanOrEqual(Date.now() - windowMs);
    expect(bind[7]).toBeNull();
    const where = (args(findAll)[0] as { where: { createdAt: Record<symbol, Date> } }).where;
    expect(Object.getOwnPropertySymbols(where.createdAt).map((s) => where.createdAt[s])).toEqual([from]);
    expect(data.meta["window"]).toEqual({ from: from.toISOString(), to: null, defaulted: true });
  });

  it("an explicit date range is used as given, not defaulted", async () => {
    const { data } = await svc.fetchAuditLogs({ tenantId: TENANT, startDate: "2020-01-01", endDate: "2020-12-31" });

    const bind = args(sql)[2] as unknown[];
    expect(bind[6]).toEqual(new Date("2020-01-01"));
    expect(bind[7]).toEqual(new Date("2020-12-31"));
    expect(data.meta["window"]).toEqual({
      from: new Date("2020-01-01").toISOString(),
      to: new Date("2020-12-31").toISOString(),
      defaulted: false,
    });
  });

  it("a single resource's history is not windowed", async () => {
    const { data } = await svc.fetchAuditLogs({ tenantId: TENANT, resourceType: "Certificate", resourceId: "c-1" });

    const bind = args(sql)[2] as unknown[];
    expect(bind.slice(4, 8)).toEqual(["Certificate", "c-1", null, null]);
    const where = (args(findAll)[0] as { where: AnyRecord }).where;
    expect(where).not.toHaveProperty("createdAt");
    expect(data.meta["window"]).toEqual({ from: null, to: null, defaulted: false });
  });
});

// ------------------------------------------------------------------
// 2. Dashboard fan-out
// ------------------------------------------------------------------
describe("P8-04 dashboard — bounded fan-out", () => {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;

  /** A model method that resolves after a tick and records concurrency. */
  const tracked = (value: unknown): Fn =>
    jest.fn(async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return value;
    });

  const load = (): {
    getDashboardMetrics: (t: string | null) => Promise<{ data: AnyRecord }>;
    runBounded: <T>(tasks: (() => Promise<T>)[], limit: number) => Promise<T[]>;
    DASHBOARD_CONCURRENCY: number;
  } => {
    jest.resetModules();
    const model = (): AnyRecord => ({ count: tracked(1), findAll: tracked([]), sum: tracked(5), findByPk: jest.fn() });
    jest.doMock("../../models", () => ({
      Op: { between: Symbol("between"), lt: Symbol("lt"), gte: Symbol("gte"), in: Symbol("in"), lte: Symbol("lte") },
      Sequelize: { fn: jest.fn(), col: jest.fn() },
      User: model(),
      Tenant: { ...model(), findByPk: jest.fn().mockResolvedValue(null) },
      CalibrationDevice: model(),
      CalibrationRecord: { ...model(), rawAttributes: {}, sequelize: { options: { timezone: "+07:00" } } },
      Certificate: model(),
      Stock: model(),
      Warehouse: model(),
      StockTransfer: model(),
      StockOpname: model(),
      MaintenanceWorkOrder: model(),
    }));
    return require("../../services/dashboard.service") as ReturnType<typeof load>;
  };

  beforeEach(() => {
    inFlight = 0;
    peak = 0;
    calls = 0;
  });

  it("never holds more than DASHBOARD_CONCURRENCY connections, and still runs all 20 queries", async () => {
    const svc = load();

    const res = await svc.getDashboardMetrics("tenant-1");

    expect(calls).toBe(20);
    expect(svc.DASHBOARD_CONCURRENCY).toBeLessThan(20);
    expect(peak).toBeLessThanOrEqual(svc.DASHBOARD_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(res.data["scope"]).toBe("tenant");
  });

  it("runBounded keeps order, and stops starting tasks after a rejection", async () => {
    const { runBounded } = load();
    const started: number[] = [];
    const task = (i: number, fail = false) => async (): Promise<number> => {
      started.push(i);
      await new Promise((resolve) => setTimeout(resolve, 5 - i));
      if (fail) {
        throw new Error(`task ${String(i)}`);
      }
      return i * 10;
    };

    await expect(runBounded([task(0), task(1), task(2), task(3)], 2)).resolves.toEqual([0, 10, 20, 30]);
    await expect(runBounded([], 4)).resolves.toEqual([]);

    started.length = 0;
    await expect(runBounded([task(0, true), task(1), task(2), task(3)], 1)).rejects.toThrow("task 0");
    expect(started).toEqual([0]);
  });
});

// ------------------------------------------------------------------
// 3. Kanban N+1
// ------------------------------------------------------------------
describe("P8-04 kanban — no query per board or per sprint", () => {
  const TID = "a0000000-0000-4000-8000-00000000000a";
  const USER = "u0000000-0000-4000-8000-000000000001";
  const ROLE = "r0000000-0000-4000-8000-000000000001";
  const BOARDS = 40;
  const board = (i: number, createdBy = "someone-else"): AnyRecord => ({
    id: `p-${String(i)}`,
    name: `Board ${String(i)}`,
    description: null,
    color: "#000",
    createdBy,
    createdAt: new Date(0),
  });

  interface ModelMock {
    findOne: Fn;
    findAll: Fn;
    count: Fn;
  }
  const MODELS = [
    "KanbanProject",
    "KanbanProjectMember",
    "KanbanColumn",
    "KanbanCard",
    "KanbanLabel",
    "KanbanCardAssignee",
    "KanbanCardLabel",
    "KanbanSprint",
    "KanbanCardRelation",
    "User",
    "Role",
  ] as const;
  let m: Record<(typeof MODELS)[number], ModelMock>;
  let svc: {
    listProjects: (u: AnyRecord) => Promise<AnyRecord[]>;
    listSprints: (u: AnyRecord, p: string) => Promise<{ sprints: AnyRecord[]; backlogCount: number }>;
  };

  beforeEach(() => {
    jest.resetModules();
    const model = (): ModelMock => ({
      findOne: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue([]),
    });
    m = Object.fromEntries(MODELS.map((name) => [name, model()])) as typeof m;
    jest.doMock("../../models", () => ({ ...m, sequelize: { transaction: jest.fn(), query: jest.fn() } }));
    jest.doMock("../../config/socket", () => ({ emitToBoard: jest.fn(), getIo: jest.fn() }));
    jest.doMock("../../services/notification.service", () => ({ emitNotification: jest.fn() }));
    jest.doMock("../../services/attachment.service", () => ({ softDeleteForResource: jest.fn() }));
    svc = require("../../services/kanban.service") as typeof svc;
  });

  const totalCalls = (): number =>
    Object.values(m).reduce(
      (sum, model) => sum + model.findOne.mock.calls.length + model.findAll.mock.calls.length + model.count.mock.calls.length,
      0,
    );

  it(`listProjects for a member of ${String(BOARDS)} boards issues 3 queries, with the same levels resolveAccess gives`, async () => {
    const user = { id: USER, tenantId: TID, role: { id: ROLE, name: "USER" } };
    m.KanbanProjectMember.findAll.mockResolvedValueOnce([
      { projectId: "p-0", accessLevel: "viewer" },
      { projectId: "p-0", accessLevel: "editor" }, // via the role: the best level wins
      { projectId: "p-1", accessLevel: "unknown-level" },
      ...Array.from({ length: BOARDS - 3 }, (_, i) => ({ projectId: `p-${String(i + 3)}`, accessLevel: "owner" })),
    ]);
    m.KanbanProject.findAll.mockResolvedValueOnce([
      board(0),
      board(1),
      board(2, USER), // the creator is an owner with no membership row
      ...Array.from({ length: BOARDS - 3 }, (_, i) => board(i + 3)),
    ]);
    m.KanbanCard.count.mockResolvedValueOnce([
      { projectId: "p-0", count: "7" },
      { projectId: "p-2", count: 3 },
    ]);

    const res = await svc.listProjects(user);

    expect(totalCalls()).toBe(3);
    expect(m.KanbanProject.findOne).not.toHaveBeenCalled();
    expect(m.KanbanCard.count).toHaveBeenCalledTimes(1);
    expect(args(m.KanbanCard.count)[0]).toMatchObject({ group: ["projectId"] });
    expect(res).toHaveLength(BOARDS);
    expect(res.slice(0, 4).map((r) => [r["cardCount"], r["myAccess"]])).toEqual([
      [7, "editor"],
      [0, null],
      [3, "owner"],
      [0, "owner"],
    ]);
  });

  it(`listProjects for a super admin over ${String(BOARDS)} boards issues 2 queries, every board "owner"`, async () => {
    const superAdmin = { id: USER, tenantId: TID, role: { id: ROLE, name: "SUPER_ADMIN" } };
    m.KanbanProject.findAll.mockResolvedValueOnce(Array.from({ length: BOARDS }, (_, i) => board(i)));

    const res = await svc.listProjects(superAdmin);

    expect(totalCalls()).toBe(2);
    expect(res.every((r) => r["myAccess"] === "owner" && r["cardCount"] === 0)).toBe(true);
  });

  it("listProjects with no board runs no count", async () => {
    const res = await svc.listProjects({ id: USER, tenantId: TID });

    expect(res).toEqual([]);
    expect(m.KanbanCard.count).not.toHaveBeenCalled();
  });

  it("listSprints counts every sprint and the backlog in ONE grouped count", async () => {
    const superAdmin = { id: USER, tenantId: TID, role: { name: "SUPER_ADMIN" } };
    m.KanbanProject.findOne.mockResolvedValueOnce({ id: "p-0", tenantId: TID });
    m.KanbanSprint.findAll.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => ({ id: `s-${String(i)}`, name: `S${String(i)}` })),
    );
    m.KanbanCard.count.mockResolvedValueOnce([
      { sprintId: "s-0", count: "4" },
      { sprintId: null, count: "2" },
    ]);

    const res = await svc.listSprints(superAdmin, "p-0");

    expect(m.KanbanCard.count).toHaveBeenCalledTimes(1);
    expect(args(m.KanbanCard.count)[0]).toEqual({
      where: { projectId: "p-0", archivedAt: null },
      group: ["sprintId"],
    });
    expect(res.sprints.map((s) => s["cardCount"])).toEqual([4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(res.backlogCount).toBe(2);
  });

  it("listSprints with an empty board reports zero backlog", async () => {
    const superAdmin = { id: USER, tenantId: TID, role: { name: "SUPER_ADMIN" } };
    m.KanbanProject.findOne.mockResolvedValueOnce({ id: "p-0", tenantId: TID });

    const res = await svc.listSprints(superAdmin, "p-0");

    expect(res).toEqual({ sprints: [], backlogCount: 0 });
  });
});
