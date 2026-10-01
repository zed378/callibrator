/**
 * A-304 (ADR-100) — GET /dashboard/metrics has a permission gate.
 *
 * Before: the route carried `auth` alone (an ACCEPTED exemption in
 * constants/routeGateExemptions, ADR-058), so every principal with a token —
 * every role, and every API key whatever its scopes — read the tenant-wide
 * aggregates. The exemption said the `dashboard` slug could not gate it
 * because FACILITY MAINTENANCE and WAREHOUSE STAFF hold no `dashboard` grant.
 *
 * The gate is `home` read: the metrics are the load call of the home page
 * (the `home` menu entry, /dashboard), and EVERY role in ROLE_MENU_ASSIGNMENTS
 * holds `home` read — asserted below — so no role that sees the home page
 * loses it. A principal without it is refused 403 in its own tenant.
 *
 * REAL router, auth mock (fixtures/routeClient), REAL dynamicAccess; the role
 * matrix is stubbed per test; dashboard.service is a spy (its grouped counts
 * are covered by its own suite), so the tenant it is asked for is observable.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as DashboardRoutes from "../../routes/api/dashboard.route";
import { ROLE_MENU_ASSIGNMENTS, MENU_SLUGS, PERMISSION_TYPES } from "../../constants/roleConstants";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/dashboard.service", () => ({
  getDashboardMetrics: jest.fn(),
}));

interface DashboardService {
  getDashboardMetrics: jest.Mock;
}
interface MatrixSource {
  getRolePermissionsMatrix(roleId: string): Promise<Record<string, string[]>>;
}
interface OverrideSource {
  getUserOverrideMatrix(userId: string): Promise<Record<string, string>>;
}

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const dashboard = jest.requireActual<typeof DashboardRoutes>("../../routes/api/dashboard.route");
const dashboardService = jest.requireMock<DashboardService>("../../services/dashboard.service");
const roles = jest.requireActual<MatrixSource>("../../services/roles.service");
const overrides = jest.requireActual<OverrideSource>("../../services/userPermission.service");

/** The role matrix every principal in the test holds. */
const holding = (matrix: Record<string, string[]>): void => {
  jest.spyOn(roles, "getRolePermissionsMatrix").mockResolvedValue(matrix);
  jest.spyOn(overrides, "getUserOverrideMatrix").mockResolvedValue({});
};

let fx: TwoTenantWorld;
let user: Principal;

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  user = fx.principal(fx.tenantA, "FACILITY MAINTENANCE");
  seedTenants(mdb, fx, [user]);
  dashboardService.getDashboardMetrics.mockReset();
  dashboardService.getDashboardMetrics.mockResolvedValue({
    status: 200,
    message: "Dashboard metrics fetched successfully",
    data: { scope: "tenant" },
  });
});

describe("A-304 — GET /dashboard/metrics is gated on `home` read", () => {
  it("every seeded role holds `home` read, so gating on it takes the page from nobody", () => {
    const missing = ROLE_MENU_ASSIGNMENTS.filter(
      (r) => r.menus[MENU_SLUGS.HOME] !== PERMISSION_TYPES.READ && r.menus[MENU_SLUGS.HOME] !== PERMISSION_TYPES.WRITE,
    ).map((r) => r.roleName);
    expect(missing).toEqual([]);
  });

  it("a principal without `home` read is refused 403 in its own tenant, and nothing is read", async () => {
    holding({ [MENU_SLUGS.DASHBOARD]: ["read"] });
    as(user);
    const res = await call(dashboard, "GET", "/metrics");
    expect(res.status).toBe(403);
    expect(dashboardService.getDashboardMetrics).not.toHaveBeenCalled();
  });

  it("with `home` read (and no `dashboard` grant, as FACILITY MAINTENANCE) it answers 200", async () => {
    holding({ [MENU_SLUGS.HOME]: ["read"] });
    as(user);
    const res = await call(dashboard, "GET", "/metrics");
    expect(res.status).toBe(200);
  });

  it("the numbers are the caller's tenant's: a ?tenantId naming another tenant is ignored", async () => {
    holding({ [MENU_SLUGS.HOME]: ["read"] });
    as(user);
    const res = await call(dashboard, "GET", "/metrics", { query: { tenantId: fx.tenantB.id } });
    expect(res.status).toBe(200);
    expect(dashboardService.getDashboardMetrics).toHaveBeenCalledWith(fx.tenantA.id);
  });

  it("an API key needs a `home` scope; any other scope is refused", async () => {
    const key = (scopes: string[]): Principal => ({
      id: "ab000000-0000-4000-8000-0000000000c1",
      username: "integration",
      tenantId: fx.tenantA.id,
      tenant: { id: fx.tenantA.id, name: fx.tenantA.name, status: fx.tenantA.status },
      role: { id: "", name: "API_KEY", roleLevel: 0 },
      isActive: true,
      status: "ACTIVE",
      isApiKey: true,
      apiKeyScopes: scopes,
    });
    as(key(["warehouse:read"]));
    expect((await call(dashboard, "GET", "/metrics")).status).toBe(403);
    as(key(["home:read"]));
    expect((await call(dashboard, "GET", "/metrics")).status).toBe(200);
    expect(dashboardService.getDashboardMetrics).toHaveBeenLastCalledWith(fx.tenantA.id);
  });
});
