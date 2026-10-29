/**
 * Two tenants — every /vendors/:vendorId route (CLAUDE.md: "Every new :id
 * route needs a two-tenant test asserting 404").
 *
 * Through the REAL vendor router, validateUuid, dynamicAccess (checkTenant
 * real; the role matrix granted), validate, controller and service, on the
 * REAL models with the REAL tenant hooks over memoryDb. For each route:
 * tenant A's vendor asked for by a tenant B principal answers 404 with a body
 * identical to an id that does not exist, and no table changes; the owning
 * tenant reaches it (so the 404 is the tenant's doing, not a broken fixture).
 *
 * @two-tenant api/vendor.route.js GET /:vendorId
 * @two-tenant api/vendor.route.js PATCH /:vendorId
 * @two-tenant api/vendor.route.js DELETE /:vendorId
 * @two-tenant api/vendor.route.js PATCH /:vendorId/qualify
 */
import type { Router } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, RouteResponse, TwoTenantWorld } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, as, call, seedTenants, grantAllMenus, probeCrossTenant } =
    jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { MISSING_ID } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<Router>("../../routes/api/vendor.route");

const VENDOR_A = "a1000000-0000-4000-8000-000000000001";

let fx: TwoTenantWorld;
let adminA: Principal;
let adminB: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  adminB = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [adminA, adminB]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: fx.tenantA.id, name: "Lab A", type: "CalibrationLab" });
});

interface VendorRoute {
    readonly name: string;
    readonly method: string;
    readonly path: (id: string) => string;
    readonly body: unknown;
}

const ROUTES: readonly VendorRoute[] = [
  { name: "GET /:vendorId", method: "GET", path: (id) => `/${id}`, body: {} },
  { name: "PATCH /:vendorId", method: "PATCH", path: (id) => `/${id}`, body: { name: "Renamed" } },
  { name: "DELETE /:vendorId", method: "DELETE", path: (id) => `/${id}`, body: {} },
  { name: "PATCH /:vendorId/qualify", method: "PATCH", path: (id) => `/${id}/qualify`, body: { approvalStatus: "APPROVED" } },
];

describe.each(ROUTES.map((r) => [r.name, r] as const))("vendors %s — two tenants", (_name, route) => {
  it("another tenant's vendor answers 404, identical to one that does not exist, and nothing is written", async () => {
    as(adminB);
    const probe = await probeCrossTenant(mdb, (id: string) => call(router, route.method, route.path(id), { body: route.body }), VENDOR_A, MISSING_ID);

    expect(probe.foreign.status).toBe(404);
    expect(probe.foreign.body).toEqual(probe.missing.body);
    expect(probe.tablesAfter).toEqual(probe.tablesBefore);
    expect(probe.committed).toEqual([]);
  });

  it("the owning tenant reaches it", async () => {
    as(adminA);
    const res: RouteResponse = await call(router, route.method, route.path(VENDOR_A), { body: route.body });

    expect(res.status).toBe(200);
  });
});
