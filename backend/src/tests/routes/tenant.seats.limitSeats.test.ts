/**
 * Seat limit — `limitSeats` is the single source (coordinator decision
 * 2026-09-30 under the owner's delegation; MEMORY/records/2026-09-30-a303-tenant-profile.md
 * § Seat limit).
 *
 * `maxUsers` was never a Tenant attribute. Tenant create defaulted it to 10 and
 * wrote it — Sequelize dropped it, and every tenant got the model's
 * `limitSeats` default (5) whatever the operator asked for. `POST
 * /tenants/user-count` answered `maxUsers: undefined` and `remainingSlots:
 * NaN` (serialised as null) for every tenant.
 *
 * Now: create takes an explicit `limitSeats` (platform-set: the route is
 * superAdminOnly) and ignores `maxUsers`; user-count reports `limitSeats` and
 * `remainingSlots` from it, both null for an unlimited tenant (quota.service's
 * rule: null, or a negative limit, is unlimited).
 *
 * REAL tenant router, auth.superAdminOnly, dynamicAccess, controller, service
 * and audit on the REAL models and hooks (fixtures/memoryDb). Doubled: `auth`,
 * the Redis endpoint limiter, the upload middleware.
 */

// P20-07: tenant creation also makes the tenant's self client facility (services/clientFacility,
// proven on memoryDb by clientFacility.service.p2007 and on PostgreSQL by clientFacilities.p2007.live).
// A fixture here: this suite is about the tenant, so the facility is a stand-in.
jest.mock("../../services/clientFacility.service", () => ({
  SELF_FACILITY_CODE: "SELF",
  selfFacilityName: (name: string): string => name,
  createSelfFacility: jest.fn(() => Promise.resolve({ id: "5e1f0000-0000-4000-8000-0000000000f0" })),
}));
import type { RequestHandler } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as UploadUtil from "../../utils/upload.util";
import type * as RouteModule from "../../routes/api/tenant.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));
jest.mock("../../utils/upload.util", () => ({
  ...jest.requireActual<typeof UploadUtil>("../../utils/upload.util"),
  upload: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenant.route");

let tenantA = "";
let superAdmin: Principal;
let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  superAdmin = fx.superAdmin;
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [superAdmin, admin]);
});

const created = (code: string): Record<string, unknown> | undefined => mdb.rows("Tenant").find((t) => t["code"] === code);

const create = (body: Record<string, unknown>): ReturnType<typeof call> =>
  call(router, "POST", "/create", { body: { name: "RS Seat", code: "SEAT", ...body }, baseUrl: "/api/v1/tenants" });

describe("tenant create: the seat limit is limitSeats, platform-set", () => {
  it("an explicit limitSeats is stored", async () => {
    as(superAdmin);
    const res = await create({ limitSeats: 25 });
    expect(res.status).toBe(201);
    expect(created("SEAT")?.["limitSeats"]).toBe(25);
  });

  it("limitSeats: null is stored as unlimited", async () => {
    as(superAdmin);
    expect((await create({ limitSeats: null })).status).toBe(201);
    expect(created("SEAT")?.["limitSeats"]).toBeNull();
  });

  it("maxUsers is not a seat count: ignored, and the model default (5) applies", async () => {
    as(superAdmin);
    const res = await create({ maxUsers: 500 });
    expect(res.status).toBe(201);
    expect(created("SEAT")?.["limitSeats"]).toBe(5);
    expect(created("SEAT")).not.toHaveProperty("maxUsers");
  });

  it.each([[0], [-1], [2.5], ["many"]])("limitSeats %p is refused (400)", async (limitSeats) => {
    as(superAdmin);
    const res = await create({ limitSeats });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("limitSeats");
    expect(created("SEAT")).toBeUndefined();
  });

  it("the create audit row records the seat limit", async () => {
    as(superAdmin);
    await create({ limitSeats: 12 });
    const audit = mdb.committed().find((w) => w.model === "AuditLog");
    expect(JSON.stringify((audit?.values as Record<string, unknown> | undefined)?.["changes"])).toContain('"limitSeats":12');
  });
});

describe("POST /tenants/user-count: remaining seats from limitSeats", () => {
  const userCount = (): ReturnType<typeof call> =>
    call(router, "POST", "/user-count", { body: { tenantId: tenantA }, baseUrl: "/api/v1/tenants" });

  // memoryDb.rows() returns copies, so the limit is set by re-seeding.
  const setLimit = (limitSeats: number | null): void => {
    mdb.reset();
    const fx = twoTenants();
    seedTenants(mdb, fx, [fx.superAdmin, fx.principal(fx.tenantA, "HEALTCARE_ADMIN")], { a: { limitSeats } });
  };

  it("a limited tenant: limitSeats and remainingSlots = limit − users (never NaN)", async () => {
    setLimit(10);
    as(admin);
    const res = await userCount();
    expect(res.status).toBe(200);
    const data = (res.body as { data: Record<string, unknown> }).data;
    // seedTenants seeded two users in tenant A (the super admin's home tenant, and the admin).
    expect(data).toEqual({ tenantId: tenantA, userCount: 2, limitSeats: 10, remainingSlots: 8, unlimited: false });
  });

  it("an over-full tenant has 0 remaining, not a negative number", async () => {
    setLimit(0);
    as(admin);
    const data = ((await userCount()).body as { data: Record<string, unknown> }).data;
    expect(data["remainingSlots"]).toBe(0);
  });

  it.each([[null], [-1]])("limitSeats %p is unlimited: limitSeats and remainingSlots are null", async (limit) => {
    setLimit(limit);
    as(admin);
    const data = ((await userCount()).body as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ limitSeats: null, remainingSlots: null, unlimited: true });
    expect(data).not.toHaveProperty("maxUsers");
  });
});
