/**
 * P24-09b — the nightly deactivation of imported accounts whose first invitation is 30 days old and
 * still unclaimed (ADR-139 § 5), over memoryDb (REAL models, hooks and audit service), and its
 * scheduler.
 *
 *  - first invitation 31 days ago, still awaiting: INACTIVE, one audit row (system actor, the facility
 *    stamped), in both tenants; the live invitation left as it is;
 *  - first invitation 10 days ago (a re-issue yesterday does not reset nor shorten it), never
 *    invited, already accepted, already inactive: untouched;
 *  - a re-run deactivates nothing more; an account that fails is counted and the others still run;
 *    one accepted between the page and its lock is left alone; more than a page is paged through;
 *  - the scheduler: default schedule, the switch, an invalid expression refused, the run's summary.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Service from "../../services/unclaimedInvitation.service";
import type * as Scheduler from "../../middlewares/unclaimedInvitationScheduler.middleware";
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
const service = jest.requireActual<typeof Service>("../../services/unclaimedInvitation.service");
const scheduler = jest.requireActual<typeof Scheduler>("../../middlewares/unclaimedInvitationScheduler.middleware");
const models = jest.requireActual<{ User: { findOne: (...a: unknown[]) => Promise<unknown> }; UserInvitation: { findOne: (...a: unknown[]) => Promise<unknown> } }>("../../models");
const cron = jest.requireMock<{ schedule: jest.Mock }>("node-cron");
const monitor = jest.requireMock<{ registerJob: jest.Mock; markDisabled: jest.Mock; refuseSchedule: jest.Mock }>("../../services/jobMonitor.service");
const ENV = environment();

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const ADMIN = "dddddddd-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-30T00:00:00Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 3600 * 1000);
const u = (n: number): string => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;

const account = (id: string, tenantId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, tenantId, username: `u${id.slice(-5)}`, email: `u${id.slice(-5)}@example.test`, password: "x", firstName: "F", lastName: "L",
  status: "ACTIVE", isActive: true, awaitingInvitation: true, clientFacilityId: null, ...extra,
});
let n = 0;
const invitation = (userId: string, tenantId: string, issued: Date, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `1a000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tenantId, userId, tokenHash: String(n).padStart(64, "0"), issuedBy: ADMIN,
  createdAt: issued, expiresAt: new Date(issued.getTime() + 7 * 24 * 3600 * 1000), acceptedAt: null, revokedAt: null, revokedBy: null, revokedReason: null, ...extra,
});
const row = (id: string): Record<string, unknown> => mdb.rows("User").find((r) => r["id"] === id) as Record<string, unknown>;
const audits = (): Record<string, unknown>[] => mdb.rows("AuditLog").filter((r) => (r["changes"] as { operation?: string } | null)?.operation === "DEACTIVATE_UNCLAIMED_ACCOUNT");

beforeEach(() => {
  mdb.reset();
  jest.clearAllMocks();
  n = 0;
  mdb.seed("Tenant", [
    { id: T, name: "Tenant A", code: "TA", status: "active" },
    { id: T2, name: "Tenant B", code: "TB", status: "active" },
  ]);
  mdb.seed("User", [
    account(u(1), T, { clientFacilityId: F1 }),
    account(u(2), T),
    account(u(3), T),
    account(u(4), T, { awaitingInvitation: false }),
    account(u(5), T, { isActive: false, status: "INACTIVE" }),
    account(u(6), T2),
  ]);
  mdb.seed("UserInvitation", [
    // u1: first 31 days ago (revoked, re-issued yesterday) — due.
    invitation(u(1), T, daysAgo(31), { revokedAt: daysAgo(1), revokedBy: ADMIN, revokedReason: "reissued" }),
    invitation(u(1), T, daysAgo(1)),
    // u2: first 10 days ago — not yet. u3: never invited.
    invitation(u(2), T, daysAgo(10)),
    // u4: accepted; u5: already inactive.
    invitation(u(4), T, daysAgo(60), { acceptedAt: daysAgo(59) }),
    invitation(u(5), T, daysAgo(60)),
    // u6: the other tenant, 45 days ago — due.
    invitation(u(6), T2, daysAgo(45)),
  ]);
});

describe("P24-09b unclaimed invitation deactivation", () => {
  it("deactivates the accounts whose first invitation is 30 days old and unclaimed, in every tenant; one audit row each", async () => {
    expect(await service.deactivateUnclaimedAccounts(NOW)).toEqual({ examined: 4, deactivated: 2, errors: 0 });
    expect([u(1), u(2), u(3), u(4), u(5), u(6)].map((id) => [row(id)["isActive"], row(id)["status"]])).toEqual([
      [false, "INACTIVE"],
      [true, "ACTIVE"],
      [true, "ACTIVE"],
      [true, "ACTIVE"],
      [false, "INACTIVE"],
      [false, "INACTIVE"],
    ]);
    expect(row(u(1))["awaitingInvitation"]).toBe(true);
    expect(audits().map((a) => [a["tenantId"], a["resourceId"], a["clientFacilityId"] ?? null, a["actorType"] ?? a["systemActor"] ?? null])).toEqual([
      [T, u(1), F1, expect.anything()],
      [T2, u(6), null, expect.anything()],
    ]);
    expect(audits()[0]?.["changes"]).toMatchObject({ reason: "INVITATION_UNCLAIMED", afterDays: 30, statusBefore: "ACTIVE", firstInvitationAt: daysAgo(31).toISOString() });
    // The live invitation is left as it is (its acceptance refuses an inactive account).
    expect(mdb.rows("UserInvitation").filter((i) => i["userId"] === u(1) && i["revokedAt"] == null)).toHaveLength(1);
  });

  it("a re-run deactivates nothing more", async () => {
    await service.deactivateUnclaimedAccounts(NOW);
    expect(await service.deactivateUnclaimedAccounts(NOW)).toEqual({ examined: 2, deactivated: 0, errors: 0 });
  });

  it("an account that fails is counted and logged; the others still run", async () => {
    const spy = jest.spyOn(models.UserInvitation, "findOne").mockRejectedValueOnce(new Error("lock timeout"));
    expect(await service.deactivateUnclaimedAccounts(NOW)).toEqual({ examined: 4, deactivated: 1, errors: 1 });
    spy.mockRestore();
  });

  it("an account accepted (or gone) between the page and its lock is left alone", async () => {
    const spy = jest.spyOn(models.User, "findOne").mockResolvedValueOnce(null);
    expect(await service.deactivateUnclaimedAccounts(NOW)).toEqual({ examined: 4, deactivated: 1, errors: 0 });
    spy.mockRestore();
  });

  it("pages through more than one page of awaiting accounts", async () => {
    mdb.seed(
      "User",
      Array.from({ length: service.UNCLAIMED_INVITATION_PAGE }, (_v, i) => account(u(100 + i), T)),
    );
    const summary = await service.deactivateUnclaimedAccounts(NOW);
    expect(summary).toEqual({ examined: 4 + service.UNCLAIMED_INVITATION_PAGE, deactivated: 2, errors: 0 });
  });
});

describe("P24-09b the scheduler", () => {
  const saved = { schedule: ENV["UNCLAIMED_INVITATION_SCHEDULER"], switch: ENV["SCHEDULERS_ENABLED"] };
  afterEach(() => {
    for (const [k, v] of [["UNCLAIMED_INVITATION_SCHEDULER", saved.schedule], ["SCHEDULERS_ENABLED", saved.switch]] as const) {
      if (v === undefined) {
        Reflect.deleteProperty(ENV, k);
      } else {
        ENV[k] = v;
      }
    }
  });

  it("schedules daily by default and registers with the job monitor", () => {
    Reflect.deleteProperty(ENV, "UNCLAIMED_INVITATION_SCHEDULER");
    Reflect.deleteProperty(ENV, "SCHEDULERS_ENABLED");
    scheduler.initUnclaimedInvitation();
    expect(cron.schedule).toHaveBeenCalledWith("47 3 * * *", expect.any(Function));
    expect(monitor.registerJob).toHaveBeenCalledWith("unclaimed-invitation", { id: "task" }, "47 3 * * *");
  });

  it("is switched off by SCHEDULERS_ENABLED=false, and refuses an invalid expression", () => {
    ENV["SCHEDULERS_ENABLED"] = "false";
    scheduler.initUnclaimedInvitation();
    expect(monitor.markDisabled).toHaveBeenCalledWith("unclaimed-invitation", "disabled via UNCLAIMED_INVITATION_SCHEDULER");
    Reflect.deleteProperty(ENV, "SCHEDULERS_ENABLED");
    ENV["UNCLAIMED_INVITATION_SCHEDULER"] = "not a cron";
    scheduler.initUnclaimedInvitation();
    expect(monitor.refuseSchedule).toHaveBeenCalledWith("unclaimed-invitation", "UNCLAIMED_INVITATION_SCHEDULER", "not a cron");
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("a run reports its summary — and the scheduled tick runs it, monitored", async () => {
    const summary = await scheduler.runUnclaimedInvitation();
    expect(summary).toMatchObject({ errors: 0 });
    Reflect.deleteProperty(ENV, "UNCLAIMED_INVITATION_SCHEDULER");
    Reflect.deleteProperty(ENV, "SCHEDULERS_ENABLED");
    scheduler.initUnclaimedInvitation();
    const tick = (cron.schedule.mock.calls as unknown[][])[0]?.[1] as () => Promise<unknown>;
    await expect(tick()).resolves.toMatchObject({ outcome: "success" });
  });

  it("a run that deactivates says so; one with a failed account warns", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      expect((await scheduler.runUnclaimedInvitation()).deactivated).toBe(2);
    } finally {
      jest.useRealTimers();
    }
    const spy = jest.spyOn(models.UserInvitation, "findOne").mockRejectedValue(new Error("lock timeout"));
    const summary = await scheduler.runUnclaimedInvitation();
    spy.mockRestore();
    expect(summary.errors).toBeGreaterThan(0);
  });
});
