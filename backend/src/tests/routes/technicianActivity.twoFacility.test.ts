/**
 * P21-07 — C-12 (P18-04 plan; P19-02 spec § 15, § 17; P18-03 N-8; threat model FT-60): the
 * technician activity list (F-73) is `GET /ipm/sessions?performedBy=` — in its FACILITY-SCOPED form
 * for a bound user. Provider staff work across facilities; a bound user must see that technician's
 * visits in ITS facility only, with the performer as printed (the snapshot, G-24), never the
 * technician's work elsewhere.
 *
 * One tenant, F1 and F2; the same unbound technician (`staff`) performed a visit in each (S1 in F1,
 * S2 in F2); a HEALTHCARE TECHNICIAN bound to F1. REAL router, gates, models and hooks (memoryDb).
 * Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import { IPM, seedIpmWorld, submittedSession, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");

interface Res {
  status: number;
  body: { data?: Record<string, unknown>[]; meta?: Record<string, unknown> };
}

let world: IpmWorld;
/** A later F1 visit by the same technician (for the date range). */
const S1_LATER = "5e550000-0000-4000-8000-0000000002f1";

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed(
    "InspectionSession",
    submittedSession(S1_LATER, world.tenantA, IPM.F1, IPM.D1, world.staff.id, {
      performedAt: new Date("2026-10-05T02:00:00Z"),
      visitNumber: 2,
      recommendation: "needs_repair",
    }),
  );
});

const activity = (principal: Principal, query: Record<string, unknown>): Promise<Res> => {
  as(principal);
  return call(sessions, "GET", "/", { query, routeFile: "api/ipmSessions.route.ts", baseUrl: "/api/v1/ipm/sessions" }) as Promise<Res>;
};
const ids = (res: Res): unknown[] => (res.body.data ?? []).map((r) => r["id"]);

describe("C-12 — the technician activity list, facility-scoped for a bound user", () => {
  it("bound to F1: the technician's F1 visits only — its F2 visit is absent, and the total says so", async () => {
    const res = await activity(world.bound, { performedBy: world.staff.id });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([S1_LATER, IPM.S1]);
    expect(res.body.meta).toMatchObject({ total: 2 });
    expect(ids(res)).not.toContain(IPM.S2);
  });

  it("bound to F1, naming F2 as a filter: an empty page (the filter cannot widen the facility)", async () => {
    const res = await activity(world.bound, { performedBy: world.staff.id, clientFacilityId: IPM.F2 });
    expect([res.status, ids(res), res.body.meta?.["total"]]).toEqual([200, [], 0]);
  });

  it("bound to F1, searching F2's device QR: nothing (the device search runs in context)", async () => {
    const res = await activity(world.bound, { performedBy: world.staff.id, q: "TST000002" });
    expect([res.status, ids(res)]).toEqual([200, []]);
  });

  it("each row shows the performer as printed (the snapshot), the facility and the device snapshot", async () => {
    const res = await activity(world.bound, { performedBy: world.staff.id, from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" });
    expect(ids(res)).toEqual([IPM.S1]);
    expect(res.body.data?.[0]).toMatchObject({
      clientFacilityId: IPM.F1,
      deviceId: IPM.D1,
      performedBy: world.staff.id,
      performerDisplay: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis", redacted: false },
    });
  });

  it("unbound provider staff: the technician's visits in every facility of the tenant", async () => {
    // `status=submitted`: the visits (staff's own F2 draft is listed by default to its creator).
    const res = await activity(world.staff, { performedBy: world.staff.id, status: "submitted" });
    expect(ids(res)).toEqual([S1_LATER, IPM.S2, IPM.S1]);
    expect(res.body.meta).toMatchObject({ total: 3 });
  });

  it("another tenant's principal: nothing of tenant A's technician", async () => {
    const res = await activity(world.other, { performedBy: world.staff.id });
    expect([res.status, ids(res)]).toEqual([200, []]);
  });
});
