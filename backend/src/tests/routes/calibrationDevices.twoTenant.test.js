/**
 * Two tenants — GET, PUT and DELETE /calibration-devices/:calibrationDeviceId
 * (CLAUDE.md: "Every new :id route needs a two-tenant test asserting 404").
 * POST /:calibrationDeviceId/restore is covered by
 * services/calibrationDevices.restore.a133.test.js.
 *
 * Through the REAL router, validateUuid, dynamicAccess (checkTenant real; the
 * role matrix granted), controller, service, attachment.service and
 * audit.service, on the REAL models with the REAL tenant hooks (memoryDb).
 * Tenant B's administrator asking for tenant A's device gets the answer an id
 * that does not exist gets, and no table changes — the audit table included.
 *
 * @two-tenant api/calibrationDevices.route.js GET /:calibrationDeviceId
 * @two-tenant api/calibrationDevices.route.js PUT /:calibrationDeviceId
 * @two-tenant api/calibrationDevices.route.js DELETE /:calibrationDeviceId
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { as, call, seedTenants, grantAllMenus, probeCrossTenant } = require("../fixtures/routeClient");
const router = require("../../routes/api/calibrationDevices.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
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
  mdb.seed("CalibrationDevice", {
    id: DEVICE_A,
    tenantId: fx.tenantA.id,
    name: "Infusion pump A",
    serialNumber: "SN-A-1",
    status: "active",
  });
});

const ROUTES = [
  ["GET /:calibrationDeviceId", "GET", {}],
  ["PUT /:calibrationDeviceId", "PUT", { name: "Renamed pump", serialNumber: "SN-NEW" }],
  ["DELETE /:calibrationDeviceId", "DELETE", {}],
];

describe.each(ROUTES)("calibration-devices %s — two tenants", (name, method, body) => {
  it("another tenant's device answers 404, identical to one that does not exist, and nothing is written", async () => {
    as(adminB);
    const probe = await probeCrossTenant(mdb, (id) => call(router, method, `/${id}`, { body }), DEVICE_A, MISSING);

    expect(probe.foreign.status).toBe(404);
    expect(probe.foreign.body).toEqual(probe.missing.body);
    expect(probe.tablesAfter).toEqual(probe.tablesBefore);
    expect(probe.committed).toEqual([]);
  });

  it("the owning tenant reaches it (and a change is written with its audit row)", async () => {
    as(adminA);
    const res = await call(router, method, `/${DEVICE_A}`, { body });

    expect(res.status).toBe(200);
    if (method !== "GET") {
      expect(mdb.committed().map((w) => w.model)).toEqual(expect.arrayContaining(["CalibrationDevice", "AuditLog"]));
    }
  });
});
