/**
 * A-295 — user.service#editUser read `user.is_active`, and `is_active` is not a
 * User attribute (it is `isActive`), so the value was always undefined.
 *
 * Measured on PostgreSQL 18.6 as callibrator_app (p9/live-a295.js, 2026-09-30):
 * the UPDATE did NOT touch `users.is_active`. Sequelize drops an undefined
 * value, so an active user stayed active and an inactive one inactive. The
 * defect was the response, which always answered `is_active: undefined`, so
 * the key vanished from the JSON the edit form reads back.
 *
 * REAL router, controller, service and User model over fixtures/memoryDb.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as UserRoutes from "../../routes/api/user.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const users = jest.requireActual<typeof UserRoutes>("../../routes/api/user.route");

let fx: TwoTenantWorld;
let admin: Principal;
let target: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  target = fx.principal(fx.tenantA, "TECHNICIAN");
  seedTenants(mdb, fx, [admin, target]);
});

/** The stored row's active flag. */
const storedActive = (id: string): unknown => mdb.rows("User").find((r) => r["id"] === id)?.["isActive"];

describe("A-295 — editing a user reports, and keeps, the active flag", () => {
  it("the response carries the user's is_active", async () => {
    as(admin);
    const res = await call(users, "PATCH", "/edit", { body: { userId: target.id, firstName: "Renamed" } });
    expect(res.status).toBe(200);
    expect((res.body as { data: Record<string, unknown> }).data["is_active"]).toBe(true);
  });

  it("an inactive user stays inactive through an edit, and says so", async () => {
    // Re-seed the target inactive (mdb.rows() returns copies).
    mdb.reset();
    grantAllMenus();
    seedTenants(mdb, fx, [admin]);
    mdb.seed("User", {
      id: target.id,
      tenantId: target.tenantId,
      username: target.username,
      email: `${target.username}@${target.tenantId.slice(0, 8)}.test`,
      password: "not-a-hash",
      roleId: target.role.id,
      status: "ACTIVE",
      isActive: false,
    });
    as(admin);
    const res = await call(users, "PATCH", "/edit", { body: { userId: target.id, firstName: "Renamed" } });
    expect(res.status).toBe(200);
    expect(storedActive(target.id)).toBe(false);
    expect((res.body as { data: Record<string, unknown> }).data["is_active"]).toBe(false);
  });
});
