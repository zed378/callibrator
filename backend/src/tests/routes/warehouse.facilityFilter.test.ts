/**
 * `GET /warehouses?kind=room&clientFacilityId=…` — one client facility's rooms (the field app's
 * working set downloads a facility's rooms, not the tenant's). A NARROWING filter:
 *  - provider staff get exactly the named facility's rows (`meta.total` counts only them);
 *  - another tenant's facility, or the other facility for a bound principal, lists nothing
 *    (the tenant predicate and the forced facility predicate still apply — G-22), never an error;
 *  - a malformed id is a 400 before the service.
 *
 * REAL: the router's chain, controller, service, model and the tenant + facility hooks over
 * memoryDb (fixtures/ipmSeed: tenant A with F1 and F2, a room in each, a store in F1; tenant B).
 * Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as WarehouseRoute from "../../routes/api/warehouse.route";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const warehouses = jest.requireActual<typeof WarehouseRoute>("../../routes/api/warehouse.route");

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
});

interface ListBody {
  success: boolean;
  data: { id: string }[] | null;
  meta?: { total: number };
}

const list = async (query: Record<string, string>): Promise<{ status: number; ids: string[]; total: number | null }> => {
  const res = await call(warehouses, "GET", "/", { query, baseUrl: "/api/v1/warehouses", routeFile: "api/warehouse.route.ts" });
  const body = res.body as ListBody;
  return { status: res.status, ids: (body.data ?? []).map((w) => w.id), total: body.meta?.total ?? null };
};

describe("GET /warehouses — the clientFacilityId filter", () => {
  it("provider staff get one facility's rooms only, counted in meta; without the filter, every room of the tenant", async () => {
    as(world.staff);
    expect(await list({ kind: "room", clientFacilityId: IPM.F1 })).toEqual({ status: 200, ids: [IPM.ROOM1], total: 1 });
    expect(await list({ kind: "room", clientFacilityId: IPM.F2 })).toEqual({ status: 200, ids: [IPM.ROOM2], total: 1 });
    expect(await list({ clientFacilityId: IPM.F1 })).toMatchObject({ status: 200, total: 2 });
    expect((await list({ kind: "room" })).ids.sort()).toEqual([IPM.ROOM1, IPM.ROOM2].sort());
  });

  it("another tenant's facility lists nothing (never an error, never its rows)", async () => {
    as(world.staff);
    expect(await list({ kind: "room", clientFacilityId: IPM.FB })).toEqual({ status: 200, ids: [], total: 0 });
    as(world.other);
    expect(await list({ kind: "room", clientFacilityId: IPM.F1 })).toEqual({ status: 200, ids: [], total: 0 });
  });

  it("a bound F1 principal naming F2 lists nothing; naming F1, its own room", async () => {
    as(world.bound);
    expect(await list({ kind: "room", clientFacilityId: IPM.F2 })).toEqual({ status: 200, ids: [], total: 0 });
    expect(await list({ kind: "room", clientFacilityId: IPM.F1 })).toEqual({ status: 200, ids: [IPM.ROOM1], total: 1 });
  });

  it("a malformed facility id is a 400", async () => {
    as(world.staff);
    expect((await list({ kind: "room", clientFacilityId: "not-a-uuid" })).status).toBe(400);
  });
});
