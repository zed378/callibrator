/**
 * P21-07 — A-10 / OQ-8 (P18-03 § 8.2; P19-04 § 9.2; threat model FT-61, AM-18, G-20): `GET
 * /dashboard/metrics` is marked facility-accessible, so a facility-BOUND user's home page loads its
 * own facility's figures — and nothing of another facility, in the answer or in the cache.
 *
 * REAL router, gate chain and facility route gate (fixtures/routeClient), REAL models and hooks
 * (memoryDb). The service is a double that computes, IN THE REQUEST'S CONTEXT, what every dashboard
 * figure depends on: a hooked count of a facility model (devices), of a provider-internal model with
 * no facility column (stocks: denied to a bound caller) and the raw reads' `facilityClause` — the
 * three mechanisms the real service's 22 aggregates use. (memoryDb cannot run the real aggregates —
 * `to_char(date_trunc(…))`, raw SQL —; `dashboard.twoFacility.p2107.live` runs every one of them on
 * PostgreSQL 18 under the same three contexts.)
 *
 * One tenant, F1 and F2 (a device in each); a HEALTHCARE TECHNICIAN bound to F1, another bound to F2,
 * unbound staff. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as DashboardRoutes from "../../routes/api/dashboard.route";
import type ModelsModule from "../../models";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";
import { facilityClause } from "../../utils/facilityPredicate.util";
import { clearDashboardCache } from "../../services/dashboardCache.service";
import { FACILITY_ACCESSIBLE_ROUTES } from "../../constants/facilityAccess";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("../../services/dashboard.service", () => ({ getDashboardMetrics: jest.fn() }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const dashboard = jest.requireActual<typeof DashboardRoutes>("../../routes/api/dashboard.route");
const dashboardService = jest.requireMock<{ getDashboardMetrics: jest.Mock }>("../../services/dashboard.service");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const ROUTE_FILE = "api/dashboard.route.ts";

interface Figures {
  devices: number;
  stocks: number;
  rawClause: string;
  rawBind: unknown[];
  context: { facilityBound: unknown; clientFacilityId: unknown };
}
interface Res {
  status: number;
  body: { data?: Figures; code?: string };
}

let world: IpmWorld;
let boundF2: Principal;

beforeEach(() => {
  clearDashboardCache();
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  boundF2 = { ...world.bound, id: "cccccccc-0000-4000-8000-0000000000f9", clientFacilityId: IPM.F2 } as unknown as Principal;
  mdb.seed("Stock", { id: "5c000000-0000-4000-8000-000000000001", tenantId: world.tenantA, itemName: "Suku cadang sintetis", sku: "SKU-1", quantity: 4, minQuantity: 1, isDeleted: false });
  dashboardService.getDashboardMetrics.mockReset().mockImplementation(async () => {
    const store = tenantStorage.getStore();
    const raw = facilityClause("d.client_facility_id", 4);
    const data: Figures = {
      devices: await (models.CalibrationDevice as unknown as { count(): Promise<number> }).count(),
      stocks: await (models.Stock as unknown as { count(): Promise<number> }).count(),
      rawClause: raw.clause,
      rawBind: raw.bind,
      context: { facilityBound: store?.facilityBound, clientFacilityId: store?.clientFacilityId },
    };
    return { success: true, status: 200, message: "Dashboard metrics fetched successfully", data };
  });
});

const metrics = (principal: Principal): Promise<Res> => {
  as(principal);
  return call(dashboard, "GET", "/metrics", { routeFile: ROUTE_FILE, baseUrl: "/api/v1/dashboard" }) as Promise<Res>;
};

describe("A-10 — GET /dashboard/metrics for a facility-bound user", () => {
  it("is marked facility-accessible (a read), so the route gate lets a bound principal through", () => {
    expect(FACILITY_ACCESSIBLE_ROUTES[ROUTE_FILE]?.["GET /metrics"]?.kind).toBe("read");
  });

  it("bound to F1: F1's device only, no provider-internal row, the raw clause bound to F1", async () => {
    const res = await metrics(world.bound);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      devices: 1,
      stocks: 0,
      rawClause: " AND d.client_facility_id = $4",
      rawBind: [IPM.F1],
      context: { facilityBound: true, clientFacilityId: IPM.F1 },
    });
  });

  it("bound to F2: F2's figures — never F1's, though F1's were computed (and cached) first", async () => {
    await metrics(world.bound);
    const res = await metrics(boundF2);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ devices: 1, stocks: 0, rawBind: [IPM.F2], context: { clientFacilityId: IPM.F2 } });
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it("unbound staff of the tenant: every facility, every provider row, no raw clause — not a bound user's cached value", async () => {
    await metrics(world.bound);
    const res = await metrics(world.staff);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ devices: 2, stocks: 1, rawClause: "", rawBind: [] });
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it("a second F1 request is F1's cached answer (the key per facility, G-20)", async () => {
    await metrics(world.bound);
    const again = await metrics(world.bound2);
    expect(again.body.data).toMatchObject({ devices: 1, rawBind: [IPM.F1] });
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it("another tenant's principal reaches its own tenant only (nothing of tenant A)", async () => {
    const res = await metrics(world.other);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ devices: 1, stocks: 0, rawClause: "" });
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(world.tenantB);
  });
});
