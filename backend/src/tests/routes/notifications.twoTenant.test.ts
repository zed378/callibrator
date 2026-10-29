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
 * @two-tenant api/notifications.route.ts PATCH /:notificationId/read
 * @two-tenant api/notifications.route.ts DELETE /:notificationId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext, TwoTenantRoute } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/notifications.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, as, call, seedTenants, probeCrossTenant } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite, MISSING_ID } =
  jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/notifications.route");

const SHARED_A = "a1000000-0000-4000-8000-000000000001";
const PERSONAL_A2 = "a1000000-0000-4000-8000-000000000002";

interface NotificationSuiteContext extends SuiteContext {
  colleague: Principal;
}

let ctx: NotificationSuiteContext;

beforeEach(() => {
  mdb.reset();
  const fx = twoTenants();
  ctx = {
    owner: fx.principal(fx.tenantA, "USER"),
    colleague: fx.principal(fx.tenantA, "TECHNICIAN"),
    other: fx.principal(fx.tenantB, "USER"),
  };
  seedTenants(mdb, fx, [ctx.owner, ctx.colleague, ctx.other]);
  mdb.seed("Notification", [
    { id: SHARED_A, tenantId: fx.tenantA.id, userId: null, type: "SYSTEM", title: "Maintenance window", message: "Tonight" },
    { id: PERSONAL_A2, tenantId: fx.tenantA.id, userId: ctx.colleague.id, type: "CALIBRATION", title: "Due", message: "Pump due" },
  ]);
});

const ROUTES: TwoTenantRoute<NotificationSuiteContext>[] = [
  { key: "PATCH /:notificationId/read", method: "PATCH", path: (id: string) => `/${id}/read`, id: () => SHARED_A, writes: ["NotificationState"] },
  { key: "DELETE /:notificationId", method: "DELETE", path: (id: string) => `/${id}`, id: () => SHARED_A, writes: ["NotificationState"] },
];

twoTenantSuite<NotificationSuiteContext>({ module: "notifications", router, mdb, context: () => ctx, routes: ROUTES });

describe.each(ROUTES.map((r) => [r.key, r]))("notifications %s — another user of the same tenant", (_key, route) => {
  it("a colleague's personal notification answers the same 404, and nothing is written", async () => {
    as(ctx.owner);
    const probe = await probeCrossTenant(mdb, (id: string) => call(router, route.method, route.path(id)), PERSONAL_A2, MISSING_ID);

    expect(probe.foreign.status).toBe(404);
    expect(probe.foreign.body).toEqual(probe.missing.body);
    expect(probe.tablesAfter).toEqual(probe.tablesBefore);
  });
});
