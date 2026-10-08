/**
 * P21-09e — the nightly deactivation of an ended facility's bound accounts (spec P19-04 § 4.6;
 * UD-18 (b)), over memoryDb (REAL models, hooks, session and audit services), and its scheduler.
 *
 *  - a facility ended 31 days ago: its ACTIVE bound users deactivated, their sessions revoked, one
 *    audit row each (system actor, the facility named); an already-inactive user, an unbound user
 *    and another facility's user untouched;
 *  - a facility ended 10 days ago: untouched (default 30); with the tenant's setting at 5: done;
 *  - a reinstated (active) facility: untouched; a re-run deactivates nothing more;
 *  - the settings: a malformed value reads as the default / no end date;
 *  - the scheduler: default schedule, the switch, an invalid expression refused, the run's summary.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Service from "../../services/boundAccountDeactivation.service";
import type * as Scheduler from "../../middlewares/boundAccountDeactivationScheduler.middleware";
import { environment } from "../../config/env";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve(true)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));
jest.mock("../../services/jobMonitor.service", () =>
  (jest.requireActual<{ create: () => unknown }>("../fixtures/jobMonitorMock")).create(),
);
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ id: "task" })),
  validate: (jest.requireActual<{ validate: (s: string) => boolean }>("node-cron")).validate,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const service = jest.requireActual<typeof Service>("../../services/boundAccountDeactivation.service");
const scheduler = jest.requireActual<typeof Scheduler>("../../middlewares/boundAccountDeactivationScheduler.middleware");
const cron = jest.requireMock<{ schedule: jest.Mock }>("node-cron");
const monitor = jest.requireMock<{ registerJob: jest.Mock; markDisabled: jest.Mock; refuseSchedule: jest.Mock }>("../../services/jobMonitor.service");
const ENV = environment();

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const OLD = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const RECENT = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const LIVE = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const T2_RECENT = "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4";
const NOW = new Date("2026-10-08T00:00:00Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 3600 * 1000);
const u = (n: number): string => `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const user = (id: string, tenantId: string, clientFacilityId: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, tenantId, username: id.slice(-4), email: `${id.slice(-4)}@example.test`, password: "x", firstName: "F", lastName: "L", clientFacilityId, status: "ACTIVE", isActive: true, ...extra,
});
const isActive = (id: string): unknown => mdb.rows("User").find((r) => r["id"] === id)?.["isActive"];

beforeEach(() => {
  mdb.reset();
  jest.clearAllMocks();
  mdb.seed("Tenant", [
    { id: T, name: "Tenant A", code: "TA", status: "active" },
    { id: T2, name: "Tenant B", code: "TB", status: "active" },
  ]);
  mdb.seed("ClientFacility", [
    { id: OLD, tenantId: T, name: "Old", code: "F-0001", status: "ended", statusChangedAt: daysAgo(31), statusReason: "left" },
    { id: RECENT, tenantId: T, name: "Recent", code: "F-0002", status: "ended", statusChangedAt: daysAgo(10), statusReason: "left" },
    { id: LIVE, tenantId: T, name: "Live", code: "F-0003", status: "active", statusChangedAt: daysAgo(90) },
    { id: T2_RECENT, tenantId: T2, name: "Other", code: "F-0004", status: "ended", statusChangedAt: daysAgo(6), statusReason: "left" },
  ]);
  mdb.seed("User", [
    user(u(1), T, OLD),
    user(u(2), T, OLD, { isActive: false, status: "INACTIVE" }),
    user(u(3), T, RECENT),
    user(u(4), T, LIVE),
    user(u(5), T, null),
    user(u(6), T2, T2_RECENT),
  ]);
  mdb.seed("Session", [
    { id: "5e550000-0000-4000-8000-000000000001", user_id: u(1), tenant_id: T, token_hash: "h1", is_revoked: false, is_active: true, expired_at: daysAgo(-1) },
  ]);
  mdb.seed("TenantSettings", { id: "e0000000-0000-4000-8000-000000000001", tenantId: T2, key: service.DEACTIVATION_DAYS_KEY, value: "5" });
});

describe("P21-09e bound account deactivation", () => {
  it("deactivates the accounts of facilities ended past their period — default 30 days, or the tenant's setting", async () => {
    const summary = await service.deactivateEndedFacilityAccounts(NOW);
    expect(summary).toEqual({ facilities: 3, due: 2, deactivated: 2, errors: 0 });
    expect([1, 2, 3, 4, 5, 6].map((n) => [n, isActive(u(n))])).toEqual([[1, false], [2, false], [3, true], [4, true], [5, true], [6, false]]);
    expect(mdb.rows("Session")[0]).toMatchObject({ is_revoked: true });
    const audits = mdb.rows("AuditLog");
    expect(audits.map((a) => [a["resourceId"], a["clientFacilityId"], a["actorName"], (a["changes"] as { operation: string }).operation])).toEqual([
      [u(1), OLD, "system:bound-account-deactivation", "DEACTIVATE_BOUND_ACCOUNT"],
      [u(6), T2_RECENT, "system:bound-account-deactivation", "DEACTIVATE_BOUND_ACCOUNT"],
    ]);
  });

  it("a facility that fails is counted and logged; the others still run", async () => {
    const models = jest.requireActual<{ User: { findAll: (...a: unknown[]) => Promise<unknown> } }>("../../models");
    const spy = jest.spyOn(models.User, "findAll").mockRejectedValueOnce(new Error("lock timeout"));
    expect(await service.deactivateEndedFacilityAccounts(NOW)).toEqual({ facilities: 3, due: 2, deactivated: 1, errors: 1 });
    spy.mockRestore();
  });

  it("a re-run deactivates nothing more", async () => {
    await service.deactivateEndedFacilityAccounts(NOW);
    expect(await service.deactivateEndedFacilityAccounts(NOW)).toEqual({ facilities: 3, due: 2, deactivated: 0, errors: 0 });
  });

  it("the settings: in range, else the default (days) or no end date (years)", async () => {
    expect(await service.deactivationDaysOf(T)).toBe(30);
    expect(await service.deactivationDaysOf(T2)).toBe(5);
    expect(await service.endedRetentionYears(T)).toBeNull();
    mdb.seed("TenantSettings", [
      { id: "e0000000-0000-4000-8000-000000000002", tenantId: T, key: service.DEACTIVATION_DAYS_KEY, value: "-3" },
      { id: "e0000000-0000-4000-8000-000000000003", tenantId: T, key: service.ENDED_RETENTION_YEARS_KEY, value: "10" },
    ]);
    expect(await service.deactivationDaysOf(T)).toBe(30);
    expect(await service.endedRetentionYears(T)).toBe(10);
  });
});

describe("P21-09e the scheduler", () => {
  const saved = { schedule: ENV["BOUND_ACCOUNT_DEACTIVATION_SCHEDULER"], switch: ENV["SCHEDULERS_ENABLED"] };
  afterEach(() => {
    for (const [k, v] of [["BOUND_ACCOUNT_DEACTIVATION_SCHEDULER", saved.schedule], ["SCHEDULERS_ENABLED", saved.switch]] as const) {
      if (v === undefined) {
        Reflect.deleteProperty(ENV, k);
      } else {
        ENV[k] = v;
      }
    }
  });

  it("schedules daily by default and registers with the job monitor", () => {
    Reflect.deleteProperty(ENV, "BOUND_ACCOUNT_DEACTIVATION_SCHEDULER");
    Reflect.deleteProperty(ENV, "SCHEDULERS_ENABLED");
    scheduler.initBoundAccountDeactivation();
    expect(cron.schedule).toHaveBeenCalledWith("37 3 * * *", expect.any(Function));
    expect(monitor.registerJob).toHaveBeenCalledWith("bound-account-deactivation", { id: "task" }, "37 3 * * *");
  });

  it("is switched off by SCHEDULERS_ENABLED=false, and refuses an invalid expression", () => {
    ENV["SCHEDULERS_ENABLED"] = "false";
    scheduler.initBoundAccountDeactivation();
    expect(monitor.markDisabled).toHaveBeenCalledWith("bound-account-deactivation", "disabled via BOUND_ACCOUNT_DEACTIVATION_SCHEDULER");
    Reflect.deleteProperty(ENV, "SCHEDULERS_ENABLED");
    ENV["BOUND_ACCOUNT_DEACTIVATION_SCHEDULER"] = "not a cron";
    scheduler.initBoundAccountDeactivation();
    expect(monitor.refuseSchedule).toHaveBeenCalledWith("bound-account-deactivation", "BOUND_ACCOUNT_DEACTIVATION_SCHEDULER", "not a cron");
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("a run reports its summary — and the scheduled tick runs it, monitored", async () => {
    const summary = await scheduler.runBoundAccountDeactivation();
    expect(summary.errors).toBe(0);
    expect(summary.facilities).toBe(3);
    Reflect.deleteProperty(ENV, "BOUND_ACCOUNT_DEACTIVATION_SCHEDULER");
    Reflect.deleteProperty(ENV, "SCHEDULERS_ENABLED");
    scheduler.initBoundAccountDeactivation();
    const tick = (cron.schedule.mock.calls as unknown[][])[0]?.[1] as () => Promise<unknown>;
    await expect(tick()).resolves.toMatchObject({ outcome: "success" });
  });

  it("a run with a failed facility warns", async () => {
    const models = jest.requireActual<{ User: { findAll: (...a: unknown[]) => Promise<unknown> } }>("../../models");
    const spy = jest.spyOn(models.User, "findAll").mockRejectedValue(new Error("lock timeout"));
    const summary = await scheduler.runBoundAccountDeactivation();
    spy.mockRestore();
    expect(summary.errors).toBeGreaterThan(0);
  });
});
