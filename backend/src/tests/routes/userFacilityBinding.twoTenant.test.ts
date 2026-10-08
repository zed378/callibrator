/**
 * P21-09 — `PUT /users/:userId/client-facility` (spec MEMORY/specs/P19-04-client-facilities.md
 * § 10.1; ADR-124 Am. 2 § 6; G-17's binding rows): the one way a user's facility changes.
 *
 * Two tenants (CLAUDE.md: every new `:id` route) and every rule of § 10.1, through the REAL
 * router, gates (dynamicAccess with checkTenant, rbac TENANT_ADMIN, validate from params+body),
 * the facility route gate, the controller, the binding service, the session service, the audit
 * service, the models and the tenant hooks over memoryDb. `set_config` (raw SQL) is answered by
 * the fixture and recorded. Doubled: the pre-invitation switch, the permission cache, the socket
 * server.
 *
 * @two-tenant api/user.route.ts PUT /:userId/client-facility
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/user.route";
import type * as BindingService from "../../services/userFacilityBinding.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as MigrationShared from "../../migrations/facilityMigration.shared";
import { ROLE_IDS } from "../../constants/roleConstants";

const mockSwitch = { enabled: true };
const mockSockets = { disconnect: jest.fn(), fail: false };
const mockRedis = { del: jest.fn<Promise<void>, [unknown]>(() => Promise.resolve()) };

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/facility", () => ({ facilityBindingEnabled: () => mockSwitch.enabled }));
jest.mock("../../config/socket", () => ({
  getIo: () => {
    if (mockSockets.fail) {
      throw new Error("Socket.io is not initialized!");
    }
    return { in: () => ({ disconnectSockets: mockSockets.disconnect }) };
  },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: (key: unknown) => mockRedis.del(key),
  cacheKeys: { userPermissions: (id: unknown) => `permissions:user:${String(id)}` },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/user.route");

const SELF_A = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const F_PAUSED = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const F_B = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";
const SUPER = "99999999-0000-4000-8000-000000000001";
const INACTIVE_ROLE = "99999999-0000-4000-8000-000000000002";
const PENDING = "99999999-0000-4000-8000-000000000003";
const REASON = "Starts at Facility One";

let ctx: SuiteContext;
let target = "";
let settings: string[] = [];

const seedUser = (id: string, tenantId: string, roleId: string, extra: Record<string, unknown> = {}): void => {
  mdb.seed("User", {
    id,
    tenantId,
    username: `u${id.slice(0, 6)}`,
    email: `${id.slice(0, 8)}@example.test`,
    password: "not-a-hash",
    roleId,
    status: "ACTIVE",
    isActive: true,
    ...extra,
  });
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  mockSwitch.enabled = true;
  mockSockets.fail = false;
  mockSockets.disconnect.mockClear();
  mockRedis.del.mockClear();
  mockRedis.del.mockImplementation(() => Promise.resolve(undefined));
  settings = [];
  mdb.onQuery((sql, options) => {
    if (sql.includes("set_config")) {
      settings.push(String((options as { bind?: unknown[] }).bind?.join("=")));
      return [{ set_config: "ok" }];
    }
    throw new Error(`unexpected raw SQL: ${sql}`);
  });
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Role", [
    { id: ROLE_IDS.HEALTHCARE_TECHNICIAN, name: "HEALTHCARE TECHNICIAN", status: "active", roleLevel: 3 },
    { id: ROLE_IDS.ROOM_USER, name: "ROOM USER", status: "active", roleLevel: 1 },
    { id: ROLE_IDS.TECHNICIAN, name: "TECHNICIAN", status: "active", roleLevel: 3 },
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", status: "active", roleLevel: 10 },
    { id: INACTIVE_ROLE, name: "ROOM USER", status: "inactive", roleLevel: 1 },
  ]);
  mdb.seed("ClientFacility", [
    { id: SELF_A, tenantId: fx.tenantA.id, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: fx.tenantA.id, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: fx.tenantA.id, name: "Facility Two", code: "F-0002", status: "active" },
    { id: F_PAUSED, tenantId: fx.tenantA.id, name: "Facility Paused", code: "F-0003", status: "inactive", statusReason: "paused" },
    { id: F_B, tenantId: fx.tenantB.id, name: "Other's", code: "F-0009", status: "active" },
  ]);
  target = "cccccccc-0000-4000-8000-000000000101";
  seedUser(target, fx.tenantA.id, ROLE_IDS.HEALTHCARE_TECHNICIAN);
  seedUser(SUPER, fx.tenantA.id, ROLE_IDS.SUPER_ADMIN);
  seedUser(PENDING, fx.tenantA.id, ROLE_IDS.TECHNICIAN, { facilityBindingPending: true });
  mdb.seed("Session", [
    { id: "5e550000-0000-4000-8000-000000000001", user_id: target, tenant_id: fx.tenantA.id, token_hash: "h1", is_revoked: false, is_active: true },
    { id: "5e550000-0000-4000-8000-000000000002", user_id: target, tenant_id: fx.tenantA.id, token_hash: "h2", is_revoked: false, is_active: true },
  ]);
});

twoTenantSuite({
  module: "users",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "PUT /:userId/client-facility",
      method: "PUT",
      path: (id) => `/${id}/client-facility`,
      id: () => target,
      body: { clientFacilityId: F1, reason: REASON },
      writes: ["User", "AuditLog"],
    },
  ],
});

const bind = (body: Record<string, unknown>, userId = target, principal: Principal = ctx.owner): ReturnType<typeof call> => {
  as(principal);
  return call(router, "PUT", `/${userId}/client-facility`, { body: { reason: REASON, ...body }, baseUrl: "/api/v1/users", routeFile: "api/user.route.ts" });
};
const userRow = (id = target): Record<string, unknown> => mdb.rows("User").find((u) => u["id"] === id) as Record<string, unknown>;
const audits = (): Record<string, unknown>[] => mdb.rows("AuditLog").filter((r) => r["resourceType"] === "User" && r["resourceId"] === target);
const liveSessions = (): number => mdb.rows("Session").filter((s) => s["user_id"] === target && !s["is_revoked"]).length;

describe("§ 10.1 — bind, re-bind, unbind", () => {
  it("binds: the facility set under the binding setting, every session revoked, one audit row in the facility", async () => {
    const res = await bind({ clientFacilityId: F1 });
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toEqual({ userId: target, clientFacilityId: F1, roleId: ROLE_IDS.HEALTHCARE_TECHNICIAN, operation: "BIND_FACILITY", sessionsRevoked: 2 });
    expect(userRow()).toMatchObject({ clientFacilityId: F1, facilityBindingPending: false });
    expect(settings).toEqual([`callibrator.facility_binding=${target}`]);
    expect(liveSessions()).toBe(0);
    expect(audits().map((a) => [a["clientFacilityId"], (a["changes"] as { operation: string }).operation])).toEqual([[F1, "BIND_FACILITY"]]);
    expect(mockRedis.del).toHaveBeenCalledWith(`permissions:user:${target}`);
    expect(mockSockets.disconnect).toHaveBeenCalledWith(true);
  });

  it("re-binds to another facility: one audit row in each (old and new); a role change in place too", async () => {
    await bind({ clientFacilityId: F1 });
    const res = await bind({ clientFacilityId: F2 });
    expect((res.body as { data: { operation: string } }).data.operation).toBe("REBIND_FACILITY");
    expect(audits().slice(1).map((a) => a["clientFacilityId"])).toEqual([F1, F2]);
    const roleOnly = await bind({ clientFacilityId: F2, roleId: ROLE_IDS.ROOM_USER });
    expect(roleOnly.status).toBe(200);
    expect(userRow()).toMatchObject({ clientFacilityId: F2, roleId: ROLE_IDS.ROOM_USER });
  });

  it("unbinds only with the role named for every facility; confirms an SSO/SCIM user unbound", async () => {
    await bind({ clientFacilityId: F1 });
    expect((await bind({ clientFacilityId: null })).status).toBe(400);
    const res = await bind({ clientFacilityId: null, roleId: ROLE_IDS.TECHNICIAN });
    expect((res.body as { data: unknown }).data).toMatchObject({ clientFacilityId: null, roleId: ROLE_IDS.TECHNICIAN, operation: "UNBIND_FACILITY" });
    expect(userRow()["clientFacilityId"]).toBeNull();
    const pending = await bind({ clientFacilityId: null, roleId: ROLE_IDS.TECHNICIAN }, PENDING);
    expect((pending.body as { data: { operation: string } }).data.operation).toBe("CONFIRM_UNBOUND");
    expect(userRow(PENDING)["facilityBindingPending"]).toBe(false);
    const none = mdb.rows("AuditLog").filter((r) => r["resourceId"] === PENDING);
    expect(none[0]?.["clientFacilityId"] ?? null).toBeNull();
  });

  it.each([
    ["the binding switch is off", () => { mockSwitch.enabled = false; }, { clientFacilityId: F1 }, 409, "Facility-bound accounts are not enabled yet."],
    ["the tenant's own facility", () => undefined, { clientFacilityId: SELF_A }, 409, "Users are not bound to the tenant's own facility — leave them unbound."],
    ["a paused facility", () => undefined, { clientFacilityId: F_PAUSED }, 409, "Users cannot be bound to a facility that is inactive."],
    ["another tenant's facility", () => undefined, { clientFacilityId: F_B }, 404, "Client facility not found"],
    ["a role outside the bound set", () => undefined, { clientFacilityId: F1, roleId: ROLE_IDS.TECHNICIAN }, 400, null],
    ["the super admin's role", () => undefined, { clientFacilityId: F1, roleId: ROLE_IDS.SUPER_ADMIN }, 403, "Forbidden: cannot assign the SUPER_ADMIN role"],
    ["an inactive role", () => undefined, { clientFacilityId: F1, roleId: INACTIVE_ROLE }, 400, "Cannot assign inactive role to user"],
    ["a role that does not exist", () => undefined, { clientFacilityId: F1, roleId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }, 404, "Role not found"],
    ["an unbound user unbound again", () => undefined, { clientFacilityId: null, roleId: ROLE_IDS.TECHNICIAN }, 409, "This user is not bound to a facility."],
  ])("refuses %s — nothing written", async (_case, arrange, body, status, message) => {
    arrange();
    const before = mdb.dump();
    const res = await bind(body);
    expect(res.status).toBe(status);
    if (message) {
      expect((res.body as { message: string }).message).toBe(message);
    }
    expect(mdb.dump()).toEqual(before);
  });

  it("refuses the same binding twice (409), the actor itself (400) and a super admin target (404)", async () => {
    await bind({ clientFacilityId: F1 });
    expect((await bind({ clientFacilityId: F1 })).status).toBe(409);
    expect((await bind({ clientFacilityId: F1 }, ctx.owner.id)).status).toBe(400);
    expect((await bind({ clientFacilityId: F1 }, SUPER)).status).toBe(404);
  });

  it("a facility-bound administrator is refused by the route gate (403, before the parameters are read)", async () => {
    const boundAdmin = { ...ctx.owner, clientFacilityId: F1 } as unknown as Principal;
    for (const id of [target, "not-a-uuid"]) {
      const res = await bind({ clientFacilityId: F2 }, id, boundAdmin);
      expect(res.status).toBe(403);
      expect((res.body as { code: string }).code).toBe("FACILITY_ROUTE_REFUSED");
    }
    expect(userRow()["clientFacilityId"] ?? null).toBeNull();
  });

  it("the after-commit steps never fail the binding (no socket server, a cache error)", async () => {
    mockSockets.fail = true;
    // The permission cache's delete fails (the session liveness deletes, at commit, do not).
    mockRedis.del.mockImplementation((key: unknown) =>
      String(key).startsWith("permissions:user:") ? Promise.reject(new Error("redis down")) : Promise.resolve(undefined),
    );
    const res = await bind({ clientFacilityId: F1 });
    expect(res.status).toBe(200);
    expect(userRow()["clientFacilityId"]).toBe(F1);
  });
});

describe("§ 10.1 — the service's own checks (behind the route gate)", () => {
  const { setBinding } = jest.requireActual<typeof BindingService>("../../services/userFacilityBinding.service");
  const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");

  it("names the setting migration 0117's users_binding_guard reads", () => {
    const { FACILITY_BINDING_SETTING } = jest.requireActual<typeof BindingService>("../../services/userFacilityBinding.service");
    const { BINDING_SETTING } = jest.requireActual<typeof MigrationShared>("../../migrations/facilityMigration.shared");
    expect(FACILITY_BINDING_SETTING).toBe(BINDING_SETTING);
  });

  it("re-checks that the actor is not bound (AM-14) — 403", async () => {
    const run = (): Promise<unknown> =>
      tenantStorage.run(
        { tenantId: ctx.owner.tenantId as never, isSuperAdmin: false, isSystemTask: false, userId: ctx.owner.id, clientFacilityId: F1 as never, facilityBound: true },
        () => setBinding(ctx.owner.tenantId as never, { userId: target, clientFacilityId: F2, reason: REASON }, { userId: ctx.owner.id }),
      );
    await expect(run()).rejects.toMatchObject({ status: 403, message: "Only an administrator who is not bound to a facility can change bindings." });
  });

  it("a user with no role cannot be bound without one (400 naming the four roles)", async () => {
    const roleless = "cccccccc-0000-4000-8000-000000000199";
    seedUser(roleless, ctx.owner.tenantId, null as unknown as string);
    const res = await bind({ clientFacilityId: F1 }, roleless);
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/HEALTHCARE ADMIN, HEALTHCARE TECHNICIAN, FACILITY MAINTENANCE, ROOM USER/);
    // With a bound role named, a roleless user is bound (its role before is none).
    const named = await bind({ clientFacilityId: F1, roleId: ROLE_IDS.ROOM_USER }, roleless);
    expect(named.status).toBe(200);
    const row = mdb.rows("AuditLog").find((r) => r["resourceId"] === roleless);
    expect((row?.["changes"] as { roleBefore: unknown }).roleBefore).toBeNull();
  });
});
