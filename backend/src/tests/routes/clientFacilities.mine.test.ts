/**
 * P21-09 — `GET /client-facilities/mine` (S-8; spec MEMORY/specs/P19-04-client-facilities.md
 * § 13.1): the one route of this router a facility-bound account may call (FACILITY_ACCESSIBLE_
 * ROUTES), answering its own facility; null for an unbound account. Another facility's row can
 * never come back: the readable rule is `id = own` and the id comes from the context only.
 *
 * REAL router, facility route gate (index registered by the route client), controller, service,
 * models and hooks over memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/clientFacilities.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/clientFacilities.route");

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
let unbound: Principal;
let boundF1: Principal;

beforeEach(() => {
  mdb.reset();
  const fx = twoTenants();
  unbound = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  boundF1 = { ...fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN"), clientFacilityId: F1 } as unknown as Principal;
  seedTenants(mdb, fx, [unbound]);
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: fx.tenantA.id, name: "Facility One", code: "F-0001", kind: "clinic", status: "active" },
    { id: F2, tenantId: fx.tenantA.id, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
});

const mine = (principal: Principal): ReturnType<typeof call> => {
  as(principal);
  return call(router, "GET", "/mine", { baseUrl: "/api/v1/client-facilities", routeFile: "api/clientFacilities.route.ts" });
};

describe("S-8 — GET /client-facilities/mine", () => {
  it("a bound account passes the route gate and reads exactly its own facility", async () => {
    const res = await mine(boundF1);
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toEqual({ id: F1, name: "Facility One", code: "F-0001", kind: "clinic", isSelf: false, status: "active" });
  });

  it("an unbound account reads null", async () => {
    const res = await mine(unbound);
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toBeNull();
  });

  it("no principal: 401", async () => {
    as(null);
    expect((await call(router, "GET", "/mine", { baseUrl: "/api/v1/client-facilities" })).status).toBe(401);
  });
});
