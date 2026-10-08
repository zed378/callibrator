/**
 * P21-09e — G-17 (spec P19-04 § 10.2 – § 10.3; AM-14, FT-43): binding at creation, and no binding
 * through any other user write.
 *
 * REAL: the users and GDPR routers (auth double → tenant context + facility route gate,
 * dynamicAccess with every grant), user.service, gdpr.service, the hooks over memoryDb.
 * DOUBLED: the FACILITY_BINDING_ENABLED switch, the seat quota, the redis cache.
 *
 *  - `POST /users/create` with `clientFacilityId`: a HEALTHCARE TECHNICIAN created BOUND to F1,
 *    audited as a bind; refused while the switch is off (409), for the self or an ended facility
 *    (409), another tenant's (404) and a role outside the bound set (400) — nothing written;
 *  - mass assignment: `clientFacilityId`, `facilityBindingPending` or `tenantId` sent to
 *    `PATCH /users/edit`, `PATCH /users/:userId/profile` and `PUT /gdpr/rectify` change NO binding
 *    (stripped or refused 400); the binding route is the one way (userFacilityBinding.twoTenant).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as UserRoute from "../../routes/api/user.route";
import type * as GdprRoute from "../../routes/api/gdpr.route";
import type { NextFunction, Request, Response } from "express";
import { ROLE_IDS } from "../../constants/roleConstants";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";
import type * as UserService from "../../services/user.service";

const mockSwitch = { enabled: true };

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/facility", () => ({ facilityBindingEnabled: () => mockSwitch.enabled }));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  ...jest.requireActual<object>("../../middlewares/enforceQuota.middleware"),
  enforceSeatQuota: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve(true)),
  incr: jest.fn(() => Promise.resolve(1)),
  expire: jest.fn(() => Promise.resolve(true)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const users = jest.requireActual<typeof UserRoute>("../../routes/api/user.route");
const gdpr = jest.requireActual<typeof GdprRoute>("../../routes/api/gdpr.route");
const userService = jest.requireActual<typeof UserService>("../../services/user.service");

const SELF = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F_ENDED = "f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5";
const F_B = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";
const TARGET = "cccccccc-0000-4000-8000-000000000101";

let admin: Principal;
let target: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  mockSwitch.enabled = true;
  const fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Role", [
    { id: ROLE_IDS.HEALTHCARE_TECHNICIAN, name: "HEALTHCARE TECHNICIAN", status: "active", roleLevel: 3 },
    { id: ROLE_IDS.TECHNICIAN, name: "TECHNICIAN", status: "active", roleLevel: 3 },
  ]);
  mdb.seed("ClientFacility", [
    { id: SELF, tenantId: fx.tenantA.id, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: fx.tenantA.id, name: "Facility One", code: "F-0001", status: "active" },
    { id: F_ENDED, tenantId: fx.tenantA.id, name: "Ended", code: "F-0005", status: "ended", statusReason: "left" },
    { id: F_B, tenantId: fx.tenantB.id, name: "Other's", code: "F-0009", status: "active" },
  ]);
  mdb.seed("User", {
    id: TARGET, tenantId: fx.tenantA.id, username: "targetuser", email: "target@example.test", password: "x", firstName: "T", lastName: "U",
    roleId: ROLE_IDS.TECHNICIAN, status: "ACTIVE", isActive: true,
  });
  target = { ...fx.principal(fx.tenantA, "TECHNICIAN"), id: TARGET };
});

const create = (body: Record<string, unknown>): ReturnType<typeof call> => {
  as(admin);
  return call(users, "POST", "/create", {
    routeFile: "api/user.route.ts",
    body: { username: "newtech", firstName: "New", lastName: "Tech", email: "newtech@example.test", password: "Str0ngPassw0rd", roleId: ROLE_IDS.HEALTHCARE_TECHNICIAN, ...body },
  });
};
const bindingOf = (id: string): unknown[] => {
  const row = mdb.rows("User").find((u) => u["id"] === id) ?? {};
  return [row["clientFacilityId"] ?? null, row["facilityBindingPending"] ?? false, row["tenantId"]];
};

describe("G-17 § 10.2 — binding at creation", () => {
  it("creates the account bound to F1, audited as a bind", async () => {
    const res = await create({ clientFacilityId: F1 });
    expect(res.status).toBe(201);
    const row = mdb.rows("User").find((u) => u["email"] === "newtech@example.test");
    expect(row?.["clientFacilityId"]).toBe(F1);
    const audit = mdb.rows("AuditLog").find((a) => a["resourceId"] === row?.["id"]);
    expect((audit?.["changes"] as { after: Record<string, unknown> }).after).toMatchObject({ clientFacilityId: F1, operation: "BIND_FACILITY" });
  });

  const switchOff = (): void => {
    mockSwitch.enabled = false;
  };
  const nothing = (): void => undefined;
  it.each([
    ["the switch off", switchOff, { clientFacilityId: F1 }, 409],
    ["the self facility", nothing, { clientFacilityId: SELF }, 409],
    ["an ended facility", nothing, { clientFacilityId: F_ENDED }, 409],
    ["another tenant's facility", nothing, { clientFacilityId: F_B }, 404],
    ["a role outside the bound set", nothing, { clientFacilityId: F1, roleId: ROLE_IDS.TECHNICIAN }, 400],
  ] as const)("%s → %i, nothing written", async (_label, arrange, body, status) => {
    arrange();
    const before = mdb.committed().length;
    const res = await create(body);
    expect(res.status).toBe(status);
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it("an unbound creation is unchanged", async () => {
    const res = await create({ roleId: ROLE_IDS.TECHNICIAN });
    expect(res.status).toBe(201);
    expect(mdb.rows("User").find((u) => u["email"] === "newtech@example.test")?.["clientFacilityId"] ?? null).toBeNull();
  });
});

describe("G-17 § 10.3 — mass assignment: no other write binds", () => {
  const smuggled = { clientFacilityId: F1, facilityBindingPending: true, tenantId: "bbbbbbbb-0000-4000-8000-000000000002" };

  it("PATCH /users/edit: the facility fields are stripped (200); a foreign tenantId is refused (404); the binding is unchanged", async () => {
    const before = bindingOf(TARGET);
    as(admin);
    const stripped = await call(users, "PATCH", "/edit", { routeFile: "api/user.route.ts", body: { userId: TARGET, firstName: "Renamed", clientFacilityId: F1, facilityBindingPending: true } });
    expect(stripped.status).toBe(200);
    const foreign = await call(users, "PATCH", "/edit", { routeFile: "api/user.route.ts", body: { userId: TARGET, ...smuggled } });
    expect(foreign.status).toBe(404);
    expect(bindingOf(TARGET)).toEqual(before);
  });

  it("PATCH /users/:userId/profile (self): the facility fields are stripped (200); the binding is unchanged", async () => {
    const before = bindingOf(TARGET);
    as(target);
    const res = await call(users, "PATCH", `/${TARGET}/profile`, { routeFile: "api/user.route.ts", body: { firstName: "Self", clientFacilityId: F1, facilityBindingPending: true } });
    expect(res.status).toBe(200);
    expect(bindingOf(TARGET)).toEqual(before);
  });

  it("PUT /gdpr/rectify naming the facility is refused (400); the binding is unchanged", async () => {
    const before = bindingOf(TARGET);
    as(target);
    for (const field of ["clientFacilityId", "facilityBindingPending", "tenantId"]) {
      const res = await call(gdpr, "PUT", "/rectify", { routeFile: "api/gdpr.route.ts", body: { field, value: F1 } });
      expect({ field, status: res.status }).toEqual({ field, status: 400 });
    }
    expect(bindingOf(TARGET)).toEqual(before);
  });
});

describe("G-17 § 10.2 — defence in depth in the service (the route is unmarked)", () => {
  const body = { username: "deepuser", firstName: "Deep", lastName: "Path", email: "deep@example.test", password: "Str0ngPassw0rd", roleId: ROLE_IDS.HEALTHCARE_TECHNICIAN, clientFacilityId: F1 };

  it("a bound actor cannot bind (403); a super admin naming no tenant finds no facility (404)", async () => {
    await expect(
      tenantStorage.run(
        { tenantId: admin.tenantId as TenantId, isSuperAdmin: false, isSystemTask: false, userId: admin.id, clientFacilityId: F1 as ClientFacilityId, facilityBound: true },
        () => userService.userCreate({ ...body, actorTenantId: admin.tenantId, actorIsSuperAdmin: false, createdBy: admin.id }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(userService.userCreate({ ...body, actorTenantId: null, actorIsSuperAdmin: true, createdBy: admin.id })).rejects.toMatchObject({ status: 404 });
  });
});
