/**
 * Two tenants — PATCH /notifications/:notificationId/read and DELETE
 * /notifications/:notificationId (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404").
 *
 * The probe uses a TENANT-WIDE notification of tenant A (userId NULL): the
 * service's recipient filter (`userId = me OR userId IS NULL`) matches it for
 * any user, so only the tenant predicate keeps tenant B out — the hardest
 * case. A personal notification of another user of the SAME tenant is also
 * refused with the same 404.
 *
 * REAL router, validateUuid, controller and notification service on the REAL
 * models and tenant hooks (fixtures/memoryDb).
 *
 * @two-tenant api/notifications.route.js PATCH /:notificationId/read
 * @two-tenant api/notifications.route.js DELETE /:notificationId
 */

jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());

const mdb = require("../fixtures/memoryDb").memoryDb();
const { createTwoTenants } = require("../fixtures/twoTenants");
const { as, call, seedTenants, probeCrossTenant } = require("../fixtures/routeClient");
const { twoTenantSuite, MISSING_ID } = require("../fixtures/twoTenantSuite");
const router = require("../../routes/api/notifications.route");

const SHARED_A = "a1000000-0000-4000-8000-000000000001";
const PERSONAL_A2 = "a1000000-0000-4000-8000-000000000002";
const ctx = {};

beforeEach(() => {
  mdb.reset();
  const fx = createTwoTenants();
  ctx.owner = fx.principal(fx.tenantA, "USER");
  ctx.colleague = fx.principal(fx.tenantA, "TECHNICIAN");
  ctx.other = fx.principal(fx.tenantB, "USER");
  seedTenants(mdb, fx, [ctx.owner, ctx.colleague, ctx.other]);
  mdb.seed("Notification", [
    { id: SHARED_A, tenantId: fx.tenantA.id, userId: null, type: "SYSTEM", title: "Maintenance window", message: "Tonight" },
    { id: PERSONAL_A2, tenantId: fx.tenantA.id, userId: ctx.colleague.id, type: "CALIBRATION", title: "Due", message: "Pump due" },
  ]);
});

const ROUTES = [
  { key: "PATCH /:notificationId/read", method: "PATCH", path: (id) => `/${id}/read`, id: () => SHARED_A, writes: ["NotificationState"] },
  { key: "DELETE /:notificationId", method: "DELETE", path: (id) => `/${id}`, id: () => SHARED_A, writes: ["NotificationState"] },
];

twoTenantSuite({ module: "notifications", router, mdb, context: () => ctx, routes: ROUTES });

describe.each(ROUTES.map((r) => [r.key, r]))("notifications %s — another user of the same tenant", (key, route) => {
  it("a colleague's personal notification answers the same 404, and nothing is written", async () => {
    as(ctx.owner);
    const probe = await probeCrossTenant(mdb, (id) => call(router, route.method, route.path(id)), PERSONAL_A2, MISSING_ID);

    expect(probe.foreign.status).toBe(404);
    expect(probe.foreign.body).toEqual(probe.missing.body);
    expect(probe.tablesAfter).toEqual(probe.tablesBefore);
  });
});
