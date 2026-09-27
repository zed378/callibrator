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

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { as, call, seedTenants, grantAllMenus, probeCrossTenant } = require("../fixtures/routeClient");
const router = require("../../routes/api/vendor.route");

const VENDOR_A = "a1000000-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let fx;
let adminA;
let adminB;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = createTwoTenants();
  adminA = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  adminB = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [adminA, adminB]);
  mdb.seed("Vendor", { id: VENDOR_A, tenantId: fx.tenantA.id, name: "Lab A", type: "CalibrationLab" });
});

const ROUTES = [
  ["GET /:vendorId", "GET", (id) => `/${id}`, {}],
  ["PATCH /:vendorId", "PATCH", (id) => `/${id}`, { name: "Renamed" }],
  ["DELETE /:vendorId", "DELETE", (id) => `/${id}`, {}],
  ["PATCH /:vendorId/qualify", "PATCH", (id) => `/${id}/qualify`, { approvalStatus: "APPROVED" }],
];

describe.each(ROUTES)("vendors %s — two tenants", (name, method, path, body) => {
  it("another tenant's vendor answers 404, identical to one that does not exist, and nothing is written", async () => {
    as(adminB);
    const probe = await probeCrossTenant(mdb, (id) => call(router, method, path(id), { body }), VENDOR_A, MISSING);

    expect(probe.foreign.status).toBe(404);
    expect(probe.foreign.body).toEqual(probe.missing.body);
    expect(probe.tablesAfter).toEqual(probe.tablesBefore);
    expect(probe.committed).toEqual([]);
  });

  it("the owning tenant reaches it", async () => {
    as(adminA);
    const res = await call(router, method, path(VENDOR_A), { body });

    expect(res.status).toBe(200);
  });
});
