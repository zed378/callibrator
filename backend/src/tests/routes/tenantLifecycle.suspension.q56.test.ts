/**
 * Q-56 (lifecycle half) — `GET /tenants/:tenantId/status` returns the
 * suspension reason and date.
 *
 * `tenants.suspension_reason` / `suspended_at` exist (written by
 * `suspendTenant`, cleared by `resumeTenant`) but `getTenantLifecycleStatus`
 * dropped them — so an operator reading the status never saw WHY the tenant
 * is suspended. Fail-before: the status body has neither key.
 *
 * REAL router, auth mocked, service, models and tenant hooks over memoryDb.
 * The status read needs `tenant-lifecycle: read` (grantAllMenus); the tenant
 * id in the path is the caller's own (checkTenant).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as LifecycleRoute from "../../routes/api/tenantLifecycle.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof LifecycleRoute>("../../routes/api/tenantLifecycle.route");

const data = (body: unknown): Record<string, unknown> => (body as { data: Record<string, unknown> }).data;

describe("Q-56 — the lifecycle status returns the suspension reason and date", () => {
  it("a suspended tenant answers its reason and suspendedAt", async () => {
    mdb.reset();
    grantAllMenus();
    const fx = twoTenants();
    const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
    seedTenants(
      mdb, fx, [admin],
      { a: { status: "suspended", suspensionReason: "billing:dunning", suspendedAt: new Date("2026-10-20T10:00:00.000Z") } },
    );
    as(admin);

    const res = await call(router, "GET", `/${fx.tenantA.id}/status`, {});
    expect(res.status).toBe(200);
    expect(data(res.body)["suspensionReason"]).toBe("billing:dunning");
    expect(new Date(data(res.body)["suspendedAt"] as string).toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });

  it("an active tenant answers nulls, with the keys present", async () => {
    mdb.reset();
    grantAllMenus();
    const fx = twoTenants();
    const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
    seedTenants(
      mdb, fx, [admin],
      { a: { status: "active", suspensionReason: null, suspendedAt: null } },
    );
    as(admin);

    const res = await call(router, "GET", `/${fx.tenantA.id}/status`, {});
    expect(res.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(data(res.body), "suspensionReason")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(data(res.body), "suspendedAt")).toBe(true);
    expect(data(res.body)["suspensionReason"]).toBeNull();
    expect(data(res.body)["suspendedAt"]).toBeNull();
  });
});
