/**
 * A-285 / A-286 / A-287 / A-294 — role and menu fields that were read or
 * written under a name that is not the model's attribute, so the code silently
 * did nothing:
 *
 *  - A-285: `role.is_system` (the attribute is `isSystem`) — updateRole's
 *    "System roles cannot be deleted" guard never fired, and deleteRole
 *    DESTROYED a system role instead of deactivating it.
 *  - A-286: createRole wrote `is_system`, which Sequelize dropped.
 *  - A-287: createMenu / updateMenu wrote `sort_order` / `is_active` (the
 *    attributes are `sortOrder` / `isActive`), which Sequelize dropped.
 *  - A-294: POST /roles validated `roleLevel` (1–8) and the controller never
 *    passed it on, so every role created through the API had level 1 and
 *    failed every privileged gate.
 *
 * The existing unit tests mocked the rows (`is_system: true` on a plain
 * object), so they passed while the real model never carried the field. These
 * run on the REAL Role / MenuGroup models and the real roles router over
 * fixtures/memoryDb; only Redis is doubled (a cache, not what is under test).
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

const SYSTEM_ROLE = "c1000000-0000-4000-8000-000000000001";
const PLAIN_ROLE = "c1000000-0000-4000-8000-000000000002";
const MENU = "c2000000-0000-4000-8000-000000000001";

/** The stored role row, deleted or not. */
const storedRole = async (id: string): Promise<{ status: unknown; isSystem: unknown; roleLevel: unknown; deletedAt: unknown } | null> => {
  const row = await models.Role.unscoped().findByPk(id, { paranoid: false });
  return row ? { status: row.status, isSystem: row.isSystem, roleLevel: row.roleLevel, deletedAt: row.deletedAt } : null;
};

let fx: ReturnType<typeof twoTenants>;
let actor: { userId: string; tenantId: string | null; ipAddress: string; userAgent: string };

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  seedTenants(mdb, fx, [fx.superAdmin]);
  actor = { userId: fx.superAdmin.id, tenantId: fx.superAdmin.tenantId, ipAddress: "127.0.0.1", userAgent: "jest" };
  mdb.seed("Role", [
    { id: SYSTEM_ROLE, name: "p9-system", isSystem: true, status: "active", roleLevel: 5 },
    { id: PLAIN_ROLE, name: "p9-plain", isSystem: false, status: "active", roleLevel: 2 },
  ]);
  mdb.seed("MenuGroup", { id: MENU, name: "P9 Menu", slug: "p9-menu", sortOrder: 1, isActive: true });
});

describe("A-285 — a system role is protected by its REAL attribute", () => {
  it("deleteRole deactivates a system role and never destroys it", async () => {
    const result = await RolesService.deleteRole(SYSTEM_ROLE, actor);
    expect(result).toEqual({ message: "System role deactivated" });
    const stored = await storedRole(SYSTEM_ROLE);
    expect(stored?.status).toBe("inactive");
    expect(stored?.deletedAt ?? null).toBeNull(); // never destroyed (the seeded row has no deletedAt key)
  });

  it("control: a non-system role is destroyed", async () => {
    const result = await RolesService.deleteRole(PLAIN_ROLE, actor);
    expect(result).toEqual({ message: "Role deleted successfully" });
    expect((await storedRole(PLAIN_ROLE))?.deletedAt).toBeInstanceOf(Date);
  });

  it("updateRole refuses status \"deleted\" on a system role (403) and changes nothing", async () => {
    await expect(RolesService.updateRole(SYSTEM_ROLE, { status: "deleted" }, actor)).rejects.toMatchObject({
      status: 403,
      message: "System roles cannot be deleted",
    });
    expect((await storedRole(SYSTEM_ROLE))?.status).toBe("active");
  });

  it("through the route: DELETE /roles/:id on a system role answers \"deactivated\"", async () => {
    as(fx.superAdmin);
    const res = await call(router, "DELETE", `/${SYSTEM_ROLE}`);
    expect(res.status).toBe(200);
    const stored = await storedRole(SYSTEM_ROLE);
    expect(stored?.status).toBe("inactive");
    expect(stored?.deletedAt ?? null).toBeNull(); // never destroyed (the seeded row has no deletedAt key)
  });
});

describe("A-286 — createRole persists the system flag it is given", () => {
  it("is_system: true is stored as isSystem = true", async () => {
    const role = await RolesService.createRole({ name: "p9-created-system", is_system: true }, actor);
    expect((await storedRole(role.id))?.isSystem).toBe(true);
  });

  it("the default is false", async () => {
    const role = await RolesService.createRole({ name: "p9-created-plain" }, actor);
    expect((await storedRole(role.id))?.isSystem).toBe(false);
  });
});

describe("A-287 — a menu's order and active flag are written", () => {
  it("createMenu stores sort_order and is_active, and audits is_active", async () => {
    const menu = await RolesService.createMenu({ name: "P9 Created", sort_order: 7, is_active: false }, actor);
    const row = await models.MenuGroup.unscoped().findByPk(menu.id);
    expect({ sortOrder: row?.sortOrder, isActive: row?.isActive }).toEqual({ sortOrder: 7, isActive: false });
    const audit = await models.AuditLog.unscoped().findOne({ where: { resourceId: menu.id }, skipTenantScope: true });
    expect((audit?.changes as { after?: Record<string, unknown> } | null)?.after).toEqual(
      expect.objectContaining({ is_active: false }),
    );
  });

  it("updateMenu changes sort_order and is_active", async () => {
    await RolesService.updateMenu(MENU, { sort_order: 9, is_active: false }, actor);
    const row = await models.MenuGroup.unscoped().findByPk(MENU);
    expect({ sortOrder: row?.sortOrder, isActive: row?.isActive }).toEqual({ sortOrder: 9, isActive: false });
  });
});

describe("A-294 — POST /roles stores the roleLevel it validated", () => {
  it("roleLevel 6 is stored as 6", async () => {
    as(fx.superAdmin);
    const res = await call(router, "POST", "/", { body: { name: "p9-level-six", roleLevel: 6 } });
    expect(res.status).toBe(201);
    const id = (res.body as { data: { id: string } }).data.id;
    expect((await storedRole(id))?.roleLevel).toBe(6);
  });

  it("no roleLevel stays level 1", async () => {
    as(fx.superAdmin);
    const res = await call(router, "POST", "/", { body: { name: "p9-level-default" } });
    const id = (res.body as { data: { id: string } }).data.id;
    expect((await storedRole(id))?.roleLevel).toBe(1);
  });
});
