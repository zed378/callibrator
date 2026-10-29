/**
 * D-16 — roles are a GLOBAL table, so every route that changes a role, a
 * role's menu permissions, or a menu group is SUPERADMIN-only.
 *
 * `roles` and `role_menu_permissions` carry no tenant column (the global
 * hooks never scope them) and `roles.name` is globally unique. That is
 * correct only while no tenant principal can write them: a tenant admin who
 * could create a role would learn, from a 409, which names other hospitals
 * use (the oracle), and a rename, a permission change or a delete would
 * change every tenant's role of that name. ADR-064 records the
 * decision: roles stay global, and the guard is "platform operator only",
 * held here route by route.
 *
 * Behaviour, not stack shape: each route is driven through the REAL router
 * with the REAL rbac/validateUuid/validate middleware; only `auth` (which
 * sets the principal) and the controllers (spies, so a refusal is proved by
 * "the handler was never reached") are replaced.
 *
 * The route inventory is pinned too: a NEW mutating route on these routers
 * fails the inventory test until it is added here — with its guard.
 */
interface Principal {
  id: string;
  tenantId: string | null;
  roleId?: string;
  role: { id: string; name: string; roleLevel?: number };
}

interface AuthMiddlewareModule {
  [key: string]: unknown;
  auth: (req: { user?: Principal | null }, res: unknown, next: () => void) => void;
}

let currentUser: Principal | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<AuthMiddlewareModule>("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req: { user?: Principal | null }, _res: unknown, next: () => void): void => {
      req.user = currentUser;
      next();
    },
  };
});

interface SpyRes {
  status(code: number): { json(payload: unknown): void };
}

const reached: string[] = [];
const mockSpyController = (names: string[]): Record<string, (req: unknown, res: SpyRes) => void> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      (_req: unknown, res: SpyRes): void => {
        reached.push(name);
        res.status(200).json({ success: true });
      },
    ]),
  );

jest.mock("../../controllers/roles.controller", () =>
  mockSpyController([
    "getAllRoles",
    "getRoleById",
    "createRole",
    "updateRole",
    "deleteRole",
    "getAllMenus",
    "getMenuById",
    "createMenu",
    "updateMenu",
    "deleteMenu",
    "assignRoleToUser",
    "removeRoleFromUser",
    "assignPermissionToRole",
    "removePermissionFromRole",
  ]),
);
jest.mock("../../controllers/menuGroup.controller", () =>
  mockSpyController([
    "filterMenuGroups",
    "getRoleMenuAssignments",
    "getMyPermissions",
    "getAvailableRoles",
    "createMenuGroup",
    "updateMenuGroup",
    "deleteMenuGroup",
    "assignMenuGroupToRole",
    "revokeMenuGroupFromRole",
    "bulkAssignMenuGroups",
    "bulkRevokeMenuGroups",
  ]),
);
jest.mock("../../controllers/userPermission.controller", () =>
  mockSpyController(["getUserPermissions", "setUserPermission", "removeUserPermission"]),
);

interface TestRouter {
  handle: (req: unknown, res: unknown, next: (err?: { status?: number; message?: string }) => void) => void;
  stack: { route?: { path: string; methods: Record<string, boolean> } }[];
}

const ROUTERS: Record<string, TestRouter> = {
  "/roles": jest.requireActual<TestRouter>("../../routes/api/roles.route"),
  "/menu-groups": jest.requireActual<TestRouter>("../../routes/api/menuGroups.route"),
  "/user-permissions": jest.requireActual<TestRouter>("../../routes/api/userPermissions.route"),
};

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";

interface CallResult {
  status: number;
  body: { message?: string | undefined } | null;
}

interface ResDouble {
  statusCode: number;
  headersSent: boolean;
  status(code: number): ResDouble;
  json(payload: CallResult["body"]): ResDouble;
  send(payload: CallResult["body"]): ResDouble;
  setHeader(): ResDouble;
  end(): ResDouble;
}

/** Drive a router through Express's own handle(); resolve with status + body. */
const call = (method: string, fullUrl: string, body: Record<string, unknown> = {}): Promise<CallResult> =>
  new Promise((resolve) => {
    const prefix = Object.keys(ROUTERS).find((p) => fullUrl.startsWith(p)) ?? "/roles";
    const router = ROUTERS[prefix] as TestRouter;
    const res: ResDouble = {
      statusCode: 200,
      headersSent: false,
      status(code: number): typeof res {
        this.statusCode = code;
        return this;
      },
      json(payload: CallResult["body"]): typeof res {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: CallResult["body"]): typeof res {
        return this.json(payload);
      },
      setHeader(): typeof res {
        return this;
      },
      end(): typeof res {
        return this.json(null);
      },
    };
    const req = {
      method,
      url: fullUrl.slice(prefix.length) || "/",
      originalUrl: fullUrl,
      body,
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: (): undefined => undefined,
    };
    router.handle(req, res, (err) => { resolve({ status: err?.status ?? 500, body: { message: err?.message } }); },
    );
  });

const tenantAdmin = (): Principal => ({
  id: ID,
  tenantId: TENANT,
  roleId: "role-ta",
  role: { id: "role-ta", name: "TENANT_ADMIN", roleLevel: 8 },
});
const superAdmin = (): Principal => ({
  id: ID,
  tenantId: null,
  role: { id: "role-sa", name: "SUPERADMIN", roleLevel: 10 },
});

/**
 * Every route that writes roles, role permissions, menu groups or per-user
 * menu permissions — [method, url, body, handler].
 */
const MUTATING: [string, string, Record<string, unknown>, string][] = [
  ["POST", "/roles", { name: "Probe" }, "createRole"],
  ["PATCH", `/roles/${ID}`, { name: "Renamed" }, "updateRole"],
  ["DELETE", `/roles/${ID}`, {}, "deleteRole"],
  ["POST", "/roles/menus", { name: "Menu" }, "createMenu"],
  ["PATCH", `/roles/menus/${ID}`, { name: "Menu" }, "updateMenu"],
  ["DELETE", `/roles/menus/${ID}`, {}, "deleteMenu"],
  ["POST", `/roles/${ID}/permissions`, { menuGroupId: ID2, permission_type: "read" }, "assignPermissionToRole"],
  ["DELETE", `/roles/${ID}/permissions/${ID2}`, {}, "removePermissionFromRole"],
  ["POST", "/roles/assign", { userId: ID, roleId: ID2 }, "assignRoleToUser"],
  ["DELETE", `/roles/assign/${ID}`, {}, "removeRoleFromUser"],
  ["POST", "/menu-groups/create", {}, "createMenuGroup"],
  ["POST", "/menu-groups/update", {}, "updateMenuGroup"],
  ["POST", "/menu-groups/delete", {}, "deleteMenuGroup"],
  ["POST", "/menu-groups/assign", {}, "assignMenuGroupToRole"],
  ["POST", "/menu-groups/revoke", {}, "revokeMenuGroupFromRole"],
  ["POST", "/menu-groups/assign-item", {}, "assignMenuGroupToRole"],
  ["POST", "/menu-groups/revoke-item", {}, "revokeMenuGroupFromRole"],
  ["POST", "/menu-groups/bulk-assign", {}, "bulkAssignMenuGroups"],
  ["POST", "/menu-groups/bulk-revoke", {}, "bulkRevokeMenuGroups"],
  ["POST", `/user-permissions/${ID}`, {}, "setUserPermission"],
  ["DELETE", `/user-permissions/${ID}/${ID2}`, {}, "removeUserPermission"],
];

/** POST routes that only READ (a filter body), guarded by ownRoleOnly instead. */
const READ_BY_POST = ["/menu-groups/filter", "/menu-groups/get-assignments"];

beforeEach(() => {
  reached.length = 0;
});

describe("D-16 — the route inventory is the reviewed one", () => {
  it("every non-GET route on the three routers is on MUTATING or READ_BY_POST", () => {
    const found: string[] = [];
    for (const [prefix, router] of Object.entries(ROUTERS)) {
      for (const layer of router.stack.filter((l) => l.route)) {
        for (const method of Object.keys(layer.route?.methods ?? {}).filter((m) => m !== "get")) {
          found.push(`${method.toUpperCase()} ${prefix}${layer.route?.path ?? ""}`.replace(/\/$/, ""));
        }
      }
    }
    const reviewed = new Set([
      ...MUTATING.map(([m, url]) =>
        `${m} ${url.replace(ID, ":id").replace(ID2, ":id2")}`
          .replace("/roles/:id/permissions/:id2", "/roles/:roleId/permissions/:menuGroupId")
          .replace("/roles/:id/permissions", "/roles/:roleId/permissions")
          .replace("/roles/assign/:id", "/roles/assign/:userId")
          .replace("/user-permissions/:id/:id2", "/user-permissions/:userId/:menuGroupId")
          .replace("/user-permissions/:id", "/user-permissions/:userId"),
      ),
      ...READ_BY_POST.map((url) => `POST ${url}`),
    ]);
    expect(found.sort()).toEqual([...reviewed].sort());
  });
});

describe("D-16 — a tenant admin cannot write a global role, permission or menu (403, handler never reached)", () => {
  it.each(MUTATING)("%s %s", async (method: string, url: string, body: Record<string, unknown>, handler: string) => {
    currentUser = tenantAdmin();
    const res = await call(method, url, body);
    expect(res.status).toBe(403);
    expect(reached).not.toContain(handler);
  });
});

describe("D-16 — the platform operator passes the same guard (the route is reachable, not dead)", () => {
  it.each(MUTATING)("%s %s", async (method: string, url: string, body: Record<string, unknown>, handler: string) => {
    currentUser = superAdmin();
    const res = await call(method, url, body);
    // Past rbac: either the (spy) handler answered, or body validation did —
    // never a 403.
    expect(res.status).not.toBe(403);
    if (res.status === 200) {
      expect(reached).toContain(handler);
    }
  });
});
