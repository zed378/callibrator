/**
 * P21-07 (ADR-126 Am. 6; P19-02 spec § 11; P18-03 N-9) — "due" for the dashboard and the planner:
 *
 *  - `GET /ipm/due?month=YYYY-MM`: the reference month is bound as `$8` (`<month>-01`, compared with
 *    `date_trunc('month', …)`), and each row's `ipmDue` is computed for that month — so the filter
 *    and the answer still agree; a past month or one beyond the 24-month horizon is a 400 with the
 *    top-level code `IPM_DUE_MONTH_OUT_OF_RANGE`, and nothing is read.
 *  - `countDue`: one raw read with the tenant BOUND on both tables and, for a facility-bound caller,
 *    the facility clause with ITS facility (C-13, G-14); the counts mapped from pg's bigint strings.
 *
 * memoryDb refuses raw SQL, so the statement is answered here (`onQuery`); the SQL itself runs on
 * PostgreSQL 18 in `dashboard.twoFacility.p2107.live`. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as ReportsRoute from "../../routes/api/ipmReports.route";
import type * as DueService from "../../services/ipmDue.service";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const reports = jest.requireActual<typeof ReportsRoute>("../../routes/api/ipmReports.route");
const dueService = jest.requireActual<typeof DueService>("../../services/ipmDue.service");

interface Res {
  status: number;
  body: { data?: Record<string, unknown>[]; meta?: Record<string, unknown>; message?: string; code?: string };
}

let world: IpmWorld;
let seen: { statement: string; bind: unknown[] }[];
let answer: Record<string, unknown>[];

/** `YYYY-MM` of the current UTC month plus `offset` months (the suite's tenant zone is UTC). */
const monthAhead = (offset: number): string => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", [
    { tenantId: world.tenantA, key: "ipm_interval_months", value: "3" },
    { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" },
  ]);
  seen = [];
  answer = [];
  mdb.onQuery((statement: string, options: { bind?: unknown }) => {
    seen.push({ statement, bind: (options.bind as unknown[] | undefined) ?? [] });
    return answer;
  });
});

const due = (principal: Principal, query: Record<string, unknown> = {}): Promise<Res> => {
  as(principal);
  return call(reports, "GET", "/due", { query, routeFile: "api/ipmReports.route.ts", baseUrl: "/api/v1/ipm" }) as Promise<Res>;
};

describe("GET /ipm/due?month=", () => {
  it("binds the reference month as $8 and computes each row's ipmDue for that month", async () => {
    // Last effective IPM two months ago, interval 3: due next month — `ok` now, `due` for next month.
    const last = new Date(`${monthAhead(-2)}-10T00:00:00Z`);
    answer = [{ id: IPM.D1, name: "Alat sintetis 1", qrCode: "TST000001", serialNumber: "SN-1", clientFacilityId: IPM.F1, status: "active", ipmIntervalMonths: null, lastPerformedAt: last, total: "1" }];
    const next = await due(world.staff, { month: monthAhead(1), state: "all_scheduled" });
    expect(next.status).toBe(200);
    expect(seen[0]?.bind[7]).toBe(`${monthAhead(1)}-01`);
    expect(seen[0]?.statement).toMatch(/COALESCE\(\$8::timestamp, now\(\) AT TIME ZONE \$4\)/);
    expect(next.body.data?.[0]?.["ipmDue"]).toEqual({ state: "due", dueMonth: monthAhead(1), lastPerformedAt: last.toISOString(), intervalMonths: 3 });

    const current = await due(world.staff, { month: monthAhead(0), state: "all_scheduled" });
    expect(current.body.data?.[0]?.["ipmDue"]).toMatchObject({ state: "ok", dueMonth: monthAhead(1) });
  });

  it.each([
    ["last month", -1],
    ["beyond the 24-month horizon", 25],
  ])("%s → 400 IPM_DUE_MONTH_OUT_OF_RANGE (top-level code), nothing read", async (_label, offset) => {
    const res = await due(world.staff, { month: monthAhead(offset) });
    expect([res.status, res.body.code]).toEqual([400, "IPM_DUE_MONTH_OUT_OF_RANGE"]);
    expect(seen).toEqual([]);
  });

  it("the horizon itself is accepted; a malformed month is the schema's 400", async () => {
    expect((await due(world.staff, { month: monthAhead(24) })).status).toBe(200);
    expect((await due(world.staff, { month: "2026-13" })).status).toBe(400);
  });
});

describe("countDue (the dashboard's counts)", () => {
  const run = <R>(work: () => Promise<R>, facility: string | null = null): Promise<R> =>
    tenantStorage.run(
      {
        tenantId: world.tenantA as TenantId,
        isSuperAdmin: false,
        isSystemTask: false,
        userId: IPM.BOUND,
        clientFacilityId: facility as ClientFacilityId | null,
        facilityBound: facility !== null,
      },
      work,
    );

  it("binds the tenant on both tables, the tenant's interval and zone; maps pg's bigint strings", async () => {
    answer = [{ scheduled: "7", due: "3", neverInspected: "1" }];
    expect(await run(() => dueService.countDue(world.tenantA))).toEqual({ scheduled: 7, due: 3, neverInspected: 1 });
    const [query] = seen;
    expect(query?.statement).toMatch(/x\.tenant_id = \$1/);
    expect(query?.statement).toMatch(/d\.tenant_id = \$1/);
    expect(query?.statement).not.toMatch(/client_facility_id/);
    expect(query?.bind).toEqual([world.tenantA, 3, "UTC"]);
  });

  it("C-13: a facility-bound caller's count carries the facility clause with its own facility", async () => {
    answer = [{ scheduled: 1, due: 1, neverInspected: 0 }];
    expect(await run(() => dueService.countDue(world.tenantA), IPM.F1)).toEqual({ scheduled: 1, due: 1, neverInspected: 0 });
    expect(seen[0]?.statement).toMatch(/AND d\.client_facility_id = \$4$/);
    expect(seen[0]?.bind).toEqual([world.tenantA, 3, "UTC", IPM.F1]);
  });

  it("no row answered reads as zero counts", async () => {
    answer = [];
    expect(await run(() => dueService.countDue(world.tenantA))).toEqual({ scheduled: 0, due: 0, neverInspected: 0 });
  });
});
