/**
 * F-19 (ADR-105) — the role dialog offers Display Name, Level and Active, and
 * the API dropped them: POST /roles read only name/description/roleLevel, and
 * PATCH /roles/:id only name/description/status. An edit of Display Name or
 * Level answered 200 and changed nothing; a role could not be created inactive.
 *
 * They are accepted now, under the ROLE_LEVELS rules:
 *  - a level stays within 1–8 (the validator) and never above the caller's own;
 *  - a system role's level is fixed — asking to change it is a 409 state
 *    explanation, and nothing is written;
 *  - every change writes its audit row (A-41) with the before/after level.
 *
 * Also: GET /roles and GET /roles/menus answer the house envelope (top-level
 * `meta`), not the last `pagination` exception.
 *
 * Runs on the REAL Role model and roles router over fixtures/memoryDb, as
 * roles.attributes.a285.test.ts does; only Redis is doubled.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type RolesServiceType from "../../services/roles.service";
import type * as RolesRoute from "../../routes/api/roles.route";
import type ModelsBarrel from "../../models";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve(true)),
  delPattern: jest.fn(() => Promise.resolve(0)),
  cacheKeys: {
    permissions: (id: string): string => `permissions:role:${id}`,
    userPermissions: (id: string): string => `permissions:user:${id}`,
  },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const RolesService = jest.requireActual<typeof RolesServiceType>("../../services/roles.service");
const router = jest.requireActual<typeof RolesRoute>("../../routes/api/roles.route");
const models = jest.requireActual<typeof ModelsBarrel>("../../models");

const SYSTEM_ROLE = "c1900000-0000-4000-8000-000000000001";
const PLAIN_ROLE = "c1900000-0000-4000-8000-000000000002";

interface StoredRole {
  nameToShow: unknown;
  status: unknown;
  roleLevel: unknown;
}

const storedRole = async (id: string): Promise<StoredRole | null> => {
  const row = await models.Role.unscoped().findByPk(id, { paranoid: false });
  return row ? { nameToShow: row.nameToShow, status: row.status, roleLevel: row.roleLevel } : null;
};

const auditFor = async (id: string): Promise<Record<string, unknown> | null> => {
  const rows = await models.AuditLog.unscoped().findAll({ where: { resourceId: id }, skipTenantScope: true });
  const last = rows[rows.length - 1];
  return last ? last.changes : null;
};

let fx: ReturnType<typeof twoTenants>;

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  seedTenants(mdb, fx, [fx.superAdmin]);
  mdb.seed("Role", [
    { id: SYSTEM_ROLE, name: "f19-system", isSystem: true, status: "active", roleLevel: 5 },
    { id: PLAIN_ROLE, name: "f19-plain", isSystem: false, status: "active", roleLevel: 2 },
  ]);
  as(fx.superAdmin);
});

describe("F-19 — POST /roles stores Display Name and Active", () => {
  it("stores nameToShow and a starting status of inactive", async () => {
    const res = await call(router, "POST", "/", {
      body: { name: "f19-created", nameToShow: "Created Role", roleLevel: 4, status: "inactive" },
    });
    expect(res.status).toBe(201);
    const id = (res.body as { data: { id: string } }).data.id;
    expect(await storedRole(id)).toEqual({ nameToShow: "Created Role", status: "inactive", roleLevel: 4 });
    expect((await auditFor(id))?.["after"]).toEqual(
      expect.objectContaining({ nameToShow: "Created Role", status: "inactive", roleLevel: 4 }),
    );
  });

  it("control: with neither, the role is active with no display name", async () => {
    const res = await call(router, "POST", "/", { body: { name: "f19-default" } });
    const id = (res.body as { data: { id: string } }).data.id;
    expect(await storedRole(id)).toEqual({ nameToShow: null, status: "active", roleLevel: 1 });
  });

  it("refuses a status other than active or inactive (400)", async () => {
    const res = await call(router, "POST", "/", { body: { name: "f19-bad", status: "deleted" } });
    expect(res.status).toBe(400);
  });
});

describe("F-19 — PATCH /roles/:id stores Display Name and Level", () => {
  it("changes nameToShow and roleLevel, and audits the level before and after", async () => {
    const res = await call(router, "PATCH", `/${PLAIN_ROLE}`, { body: { nameToShow: "Plain", roleLevel: 6 } });
    expect(res.status).toBe(200);
    expect(await storedRole(PLAIN_ROLE)).toEqual({ nameToShow: "Plain", status: "active", roleLevel: 6 });
    const audit = await auditFor(PLAIN_ROLE);
    expect(audit?.["operation"]).toBe("UPDATE_ROLE");
    expect(audit?.["before"]).toEqual(expect.objectContaining({ roleLevel: 2 }));
    expect(audit?.["after"]).toEqual(expect.objectContaining({ roleLevel: 6, nameToShow: "Plain" }));
  });

  it("refuses a level above 8 (400) and changes nothing", async () => {
    const res = await call(router, "PATCH", `/${PLAIN_ROLE}`, { body: { roleLevel: 10 } });
    expect(res.status).toBe(400);
    expect((await storedRole(PLAIN_ROLE))?.roleLevel).toBe(2);
  });

  it("refuses to change a system role's level with a 409 that explains the state", async () => {
    const res = await call(router, "PATCH", `/${SYSTEM_ROLE}`, { body: { roleLevel: 7 } });
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toMatch(/system role; its level \(5\) is fixed/);
    expect((await storedRole(SYSTEM_ROLE))?.roleLevel).toBe(5);
  });

  it("control: a system role's unchanged level is accepted with its other fields", async () => {
    const res = await call(router, "PATCH", `/${SYSTEM_ROLE}`, { body: { roleLevel: 5, nameToShow: "System" } });
    expect(res.status).toBe(200);
    expect(await storedRole(SYSTEM_ROLE)).toEqual({ nameToShow: "System", status: "active", roleLevel: 5 });
  });
});

describe("F-19 — a role's level never exceeds the caller's own", () => {
  const actorAt = (roleLevel: number): { userId: string; tenantId: string | null; roleLevel: number } => ({
    userId: fx.superAdmin.id,
    tenantId: fx.superAdmin.tenantId,
    roleLevel,
  });

  it("an edit above the caller's level is refused (403) and nothing is written", async () => {
    await expect(RolesService.updateRole(PLAIN_ROLE, { roleLevel: 6 }, actorAt(5))).rejects.toMatchObject({
      status: 403,
    });
    expect((await storedRole(PLAIN_ROLE))?.roleLevel).toBe(2);
  });

  it.each([
    ["zero", 0],
    ["a fraction", 2.5],
    ["not a number", "high"],
  ])("an edit to %s is refused (403) when it reaches the service without the validator", async (_label, level) => {
    await expect(RolesService.updateRole(PLAIN_ROLE, { roleLevel: level }, actorAt(10))).rejects.toMatchObject({
      status: 403,
    });
    expect((await storedRole(PLAIN_ROLE))?.roleLevel).toBe(2);
  });

  it("a null level or an unchanged one writes no level; a blank display name clears it", async () => {
    await RolesService.updateRole(PLAIN_ROLE, { roleLevel: null, nameToShow: "Kept" }, actorAt(10));
    await RolesService.updateRole(PLAIN_ROLE, { roleLevel: 2, nameToShow: "  " }, actorAt(10));
    expect(await storedRole(PLAIN_ROLE)).toEqual({ nameToShow: null, status: "active", roleLevel: 2 });
    expect((await auditFor(PLAIN_ROLE))?.["after"]).toEqual({ nameToShow: null });
  });

  it("a create above the caller's level is clamped to it", async () => {
    const role = await RolesService.createRole({ name: "f19-clamped", roleLevel: 7 }, actorAt(5));
    expect((await storedRole(role.id))?.roleLevel).toBe(5);
  });
});

describe("F-19 — the role lists answer the house envelope", () => {
  it("GET / puts pagination in a top-level meta, never `pagination`", async () => {
    const res = await call(router, "GET", "/", { query: { page: "1", limit: "1" } });
    expect(res.status).toBe(200);
    const body = res.body as { pagination?: unknown; meta?: unknown; data?: unknown };
    expect(body.pagination).toBeUndefined();
    expect(body.meta).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2 });
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /menus does too", async () => {
    const res = await call(router, "GET", "/menus");
    const body = res.body as { pagination?: unknown; meta?: unknown };
    expect(body.pagination).toBeUndefined();
    expect(body.meta).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
  });
});
