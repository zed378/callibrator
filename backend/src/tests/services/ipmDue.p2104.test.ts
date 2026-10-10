/**
 * P21-04 — "due" (P19-02 spec § 11; ADR-126 § 6): `GET /ipm/due` is one raw read per page.
 *
 * memoryDb refuses raw SQL, so this suite answers the statement (`onQuery`) and asserts what reaches
 * the database: the tenant predicate BOUND on both tables (`d.tenant_id = $1`, `x.tenant_id = $1`),
 * the tenant's interval, zone and filter, the page; for a facility-BOUND caller the facility clause
 * with the caller's facility (C-13, G-14 — an F1 user's read can never name F2); and each row's
 * `ipmDue` from `computeIpmDue`. The SQL itself (the LATERAL effective session, the month arithmetic)
 * runs on PostgreSQL 18 in `ipmSubmit.p2104.live`. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as ReportsRoute from "../../routes/api/ipmReports.route";
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

interface Res {
  status: number;
  body: { data?: Record<string, unknown>[]; meta?: Record<string, unknown>; message?: string };
}

let world: IpmWorld;
let seen: { statement: string; bind: unknown[] }[];
let answer: Record<string, unknown>[];

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  seen = [];
  answer = [];
  mdb.onQuery((statement: string, options: { bind?: unknown }) => {
    seen.push({ statement, bind: (options.bind as unknown[] | undefined) ?? [] });
    return answer;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const due = (principal: Principal, query: Record<string, unknown> = {}): Promise<Res> => {
  as(principal);
  return call(reports, "GET", "/due", { query, routeFile: "api/ipmReports.route.ts", baseUrl: "/api/v1/ipm" }) as Promise<Res>;
};

const device = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: IPM.D1,
  name: "Alat sintetis 1",
  qrCode: "TST000001",
  serialNumber: "SN-1",
  clientFacilityId: IPM.F1,
  status: "active",
  ipmIntervalMonths: null,
  lastPerformedAt: null,
  total: "3",
  ...over,
});

describe("GET /ipm/due", () => {
  it("binds the tenant on both tables, the tenant's interval and zone, the filter and the page; maps each row with computeIpmDue", async () => {
    mdb.seed("TenantSettings", [
      { tenantId: world.tenantA, key: "ipm_interval_months", value: "1" },
      { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" },
    ]);
    answer = [
      device({}),
      device({ id: IPM.D2, clientFacilityId: IPM.F2, lastPerformedAt: new Date("2020-01-15T00:00:00Z") }),
      device({ id: "d1000000-0000-4000-8000-0000000000f9", ipmIntervalMonths: 60, lastPerformedAt: "2026-10-01T00:00:00.000Z" }),
    ];
    const res = await due(world.staff, { page: "2", limit: "10", state: "all_scheduled" });
    expect([res.status, res.body.message]).toEqual([200, "IPM due list"]);
    expect(res.body.meta).toEqual({ total: 3, page: 2, limit: 10, totalPages: 1 });
    expect(res.body.data?.map((d) => d["ipmDue"])).toEqual([
      { state: "never_inspected", intervalMonths: 1 },
      { state: "due", dueMonth: "2020-02", lastPerformedAt: "2020-01-15T00:00:00.000Z", intervalMonths: 1 },
      { state: "ok", dueMonth: "2031-10", lastPerformedAt: "2026-10-01T00:00:00.000Z", intervalMonths: 60 },
    ]);
    expect(res.body.data?.[0]).toEqual({
      id: IPM.D1,
      name: "Alat sintetis 1",
      qrCode: "TST000001",
      serialNumber: "SN-1",
      clientFacilityId: IPM.F1,
      status: "active",
      ipmIntervalMonths: null,
      ipmDue: { state: "never_inspected", intervalMonths: 1 },
    });
    const [query] = seen;
    expect(query?.statement).toMatch(/x\.tenant_id = \$1/);
    expect(query?.statement).toMatch(/d\.tenant_id = \$1/);
    // P21-07: $8 is the reference month (null = the current one); an unbound caller has no $9.
    expect(query?.statement).not.toMatch(/\$9/);
    expect(query?.bind).toEqual([world.tenantA, 1, "all_scheduled", "UTC", 10, 10, null, null]);
  });

  it("defaults: state due, page 1, the zone Asia/Jakarta, no tenant interval; an empty page is total 0", async () => {
    const res = await due(world.staff, { clientFacilityId: IPM.F2 });
    expect([res.status, res.body.data, res.body.meta]).toEqual([200, [], { total: 0, page: 1, limit: 25, totalPages: 0 }]);
    expect(seen[0]?.bind).toEqual([world.tenantA, null, "due", "Asia/Jakarta", 25, 0, IPM.F2, null]);
  });

  /**
   * C-13 (G-14): a facility-bound caller's read carries the facility clause with ITS facility — a
   * foreign `clientFacilityId` filter cannot widen it (both predicates apply; the F2 filter then
   * matches nothing on PostgreSQL).
   */
  it("a facility-bound caller: the facility clause binds its own facility, whatever filter it sends", async () => {
    await due(world.bound, { clientFacilityId: IPM.F2 });
    const [query] = seen;
    expect(query?.statement).toMatch(/AND d\.client_facility_id = \$9/);
    expect(query?.bind).toEqual([world.tenantA, null, "due", "Asia/Jakarta", 25, 0, IPM.F2, null, IPM.F1]);
  });

  it("a filter outside the vocabulary → 400, nothing read", async () => {
    expect((await due(world.staff, { state: "late" })).status).toBe(400);
    expect(seen).toEqual([]);
  });
});
