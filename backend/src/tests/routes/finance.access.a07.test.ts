/**
 * A-07 — the asset-finance routes gated on a menu name that does not exist.
 *
 * `finance.route.js` gated all six routes on `dynamicAccess(["Finance",
 * "Billing"], …)`. The seeded menu is NAME "Asset Finance", SLUG `finance`
 * (`seedMenuGroups.util.js`). `getRolePermissionsMatrix` keys the matrix by the
 * exact name and slug of each granted menu, so "Finance" was in nobody's
 * matrix, and the gate resolved only through "Billing" — a grant no seeded role
 * holds. So HEALTHCARE ADMIN, CALIBRATOR ADMIN and ENGINEERING MANAGER, which
 * `ROLE_MENU_ASSIGNMENTS` grants `finance: read`, were refused (403) on every
 * finance route: SUPERADMIN-only, silently. An API key scoped `finance:read`
 * was ADMITTED, because `scopeAllows` lower-cases "Finance" to `finance` — the
 * same grant answered two ways depending on the kind of principal.
 *
 * These are behaviour tests. Only `auth` is stubbed. `dynamicAccess` is the
 * real middleware, and so is `RolesService.getRolePermissionsMatrix`: it runs
 * against rows built from `ROLE_MENU_ASSIGNMENTS` and the real seed's menu tree
 * (names, slugs, parents) exactly as the seed writes `role_menu_permissions`,
 * so the NAME keys and one-level child inheritance are the production ones,
 * not a friendlier fixture. Restoring `["Finance", "Billing"]` fails every
 * admin-read test below with 403.
 */

import fs from "fs";
import path from "path";
import type { Request, Response, NextFunction } from "express";
import type * as AuthMiddleware from "../../middlewares/auth.middleware";

interface MockUser {
  id: string;
  tenantId: string;
  role: { id: string; name: string };
  isApiKey?: boolean;
  apiKeyScopes?: string[];
}

let mockCurrentUser: MockUser | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof AuthMiddleware>("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: MockUser | null }).user = mockCurrentUser;
      next();
    },
  };
});

// The models the real roles.service and dynamicAccess touch. Rows come from the
// seed below; `checkTenant` has no tenantId/userId to look up in these requests.
jest.mock("../../models", () => {
  const mockModels = {
    Role: { findByPk: jest.fn() },
    RoleMenuPermission: { findAll: jest.fn() },
    MenuGroup: {},
    User: { findByPk: jest.fn() },
    Tenants: { findByPk: jest.fn() },
  };
  return {
    ...mockModels,
    __esModule: true,
    default: mockModels,
  };
});

// No cache: every lookup rebuilds the matrix from the rows.
jest.mock("../../services/redis.service", () => {
  const mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(),
    delPattern: jest.fn(),
    cacheKeys: { permissions: (id: string) => `perm:${id}`, userPermissions: (id: string) => `uperm:${id}` },
  };
  return {
    ...mockRedis,
    __esModule: true,
    default: mockRedis,
  };
});
jest.mock("../../services/userPermission.service", () => ({
  __esModule: true,
  default: {
    getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
  },
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));

// Body validation runs AFTER the gate and is not what is under test.
jest.mock("../../middlewares/validation.middleware", () => ({
  validate: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));

const mockReached = (name: string) =>
  jest.fn((_req: Request, res: Response) => res.status(200).json({ success: true, handler: name }));

jest.mock("../../controllers/finance.controller", () => ({
  __esModule: true,
  getDepreciationReport: mockReached("getDepreciationReport"),
  fetchAssetFinances: mockReached("fetchAssetFinances"),
  createAssetFinance: mockReached("createAssetFinance"),
  getAssetFinanceById: mockReached("getAssetFinanceById"),
  updateAssetFinance: mockReached("updateAssetFinance"),
  deleteAssetFinance: mockReached("deleteAssetFinance"),
}));

interface MockModel {
  findByPk: jest.Mock;
  findAll: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- models mocked above
const { Role, RoleMenuPermission } = require("../../models") as { Role: MockModel; RoleMenuPermission: MockModel };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- controller mocked above
const financeController = require("../../controllers/finance.controller") as Record<string, jest.Mock>;
import { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } from "../../constants";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS service
const RolesService = require("../../services/roles.service") as typeof import("../../services/roles.service");

interface ExpressRouter {
  handle: (
    req: unknown,
    res: unknown,
    next: (err?: { status?: number; statusCode?: number; message?: string }) => void,
  ) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS export = router
const router = require("../../routes/api/finance.route") as ExpressRouter;

// ---- the real seed's menu tree ----------------------------------------------
// Each `{ … slug: "…" … }` literal in `menuData`, with its name and parentSlug.
const SEED = fs.readFileSync(
  path.join(__dirname, "..", "..", "utils", "seedMenuGroups.util.ts"),
  "utf8",
);
const MENU_DATA = SEED.slice(SEED.indexOf("const menuData = ["), SEED.indexOf("];", SEED.indexOf("const menuData = [")));
const MENUS = [...MENU_DATA.matchAll(/\{[^{}]*?slug:\s*"([^"]+)"[^{}]*?\}/g)].map((m) => {
  const nameMatch = /name:\s*"([^"]+)"/.exec(m[0]);
  const parentSlugMatch = /parentSlug:\s*"([^"]+)"/.exec(m[0]);
  return {
    slug: m[1] ?? "",
    name: nameMatch?.[1] ?? "",
    parentSlug: parentSlugMatch?.[1] ?? "",
  };
});
interface MenuRow {
  name: string;
  slug: string;
  children: { name: string; slug: string }[];
}
const menuRow = (slug: string): MenuRow | null => {
  const menu = MENUS.find((m) => m.slug === slug);
  if (!menu) {
    return null; // the seed skips an assignment whose slug it does not create
  }
  return {
    name: menu.name,
    slug: menu.slug,
    children: MENUS.filter((c) => c.parentSlug === slug).map((c) => ({ name: c.name, slug: c.slug })),
  };
};

// `role_menu_permissions` rows for a role, as migration.service#seedMenuGroupsAndItems writes them.
const rowsFor = (roleName: string) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  return Object.entries(entry ? entry.menus : {})
    .map(([slug, permissionType]) => ({ permissionType, menu: menuRow(slug) }))
    .filter((row): row is typeof row & { menu: MenuRow } => row.menu !== null);
};

interface HttpResponse {
  status: number;
  body: { success?: boolean; handler?: string; message?: string } | null;
}

const http = (method: string, url: string): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: { success?: boolean; handler?: string; message?: string } | null) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: { success?: boolean; handler?: string; message?: string } | null) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/finance" + url,
      body: {},
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err?: { status?: number; statusCode?: number; message?: string }) => {
      resolve({
        status: err ? (err.status ?? err.statusCode ?? 500) : 404,
        body: { message: (err ? err.message : "no route") as string },
      });
    });
  });

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "33333333-3333-4333-8333-333333333333";
const FINANCE_ID = "44444444-4444-4444-8444-444444444444";

const asRole = (roleName: string) => {
  mockCurrentUser = { id: USER_ID, tenantId: TENANT, role: { id: roleName, name: roleName } };
};
const asApiKey = (scopes: string[]) => {
  mockCurrentUser = {
    id: USER_ID,
    tenantId: TENANT,
    role: { id: "api-key", name: "API_KEY" },
    isApiKey: true,
    apiKeyScopes: scopes,
  };
};

const READS: [string, string, string][] = [
  ["get", "/reports/depreciation", "getDepreciationReport"],
  ["get", "/", "fetchAssetFinances"],
  ["get", "/" + FINANCE_ID, "getAssetFinanceById"],
];
const WRITES: [string, string, string][] = [
  ["post", "/", "createAssetFinance"],
  ["patch", "/" + FINANCE_ID, "updateAssetFinance"],
  ["delete", "/" + FINANCE_ID, "deleteAssetFinance"],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  Role.findByPk.mockImplementation((id: string) => Promise.resolve({ id, status: "active" }));
  RoleMenuPermission.findAll.mockImplementation(({ where }: { where: { roleId: string } }) =>
    Promise.resolve(rowsFor(where.roleId)),
  );
});

describe("A-07 — finance routes gate on the seeded `finance` slug", () => {
  it("the fixture is the production one: the menu is NAME 'Asset Finance', SLUG 'finance'", async () => {
    // Guards the fixture — if either moved, the tests below would prove nothing.
    expect(MENU_SLUGS.FINANCE).toBe("finance");
    expect(menuRow("finance")).toMatchObject({ name: "Asset Finance", slug: "finance" });
    const matrix = await RolesService.getRolePermissionsMatrix(ROLE_NAMES.HEALTCARE_ADMIN);
    expect(matrix["finance"]).toEqual(["read"]);
    expect(matrix["Asset Finance"]).toEqual(["read"]);
    // What the old gate asked for is in nobody's matrix. (`Billing` — the
    // subscription page — is now granted READ by Q-20, and is a different
    // menu from asset finance: its grant still reaches none of these routes,
    // as the `billing:*` key test below shows.)
    expect(matrix["Finance"]).toBeUndefined();
    expect(matrix["Billing"]).toEqual(["read"]);
  });

  describe.each([
    ROLE_NAMES.HEALTCARE_ADMIN,
    ROLE_NAMES.CALIBRATOR_ADMIN,
    ROLE_NAMES.ENGINEERING_MANAGER,
  ])("a role holding `finance: read` (%s)", (roleName) => {
    it.each(READS)("reaches %s %s", async (method, url, handler) => {
      asRole(roleName);

      const res = await http(method, url);

      expect(res.status).toBe(200);
      expect(res.body?.handler).toBe(handler);
      expect(financeController[handler]).toHaveBeenCalledTimes(1);
    });

    it.each(WRITES)("is refused %s %s — it holds read, not write", async (method, url, handler) => {
      asRole(roleName);

      const res = await http(method, url);

      expect(res.status).toBe(403);
      expect(financeController[handler]).not.toHaveBeenCalled();
    });
  });

  it("a role with no `finance` grant is refused on all six routes", async () => {
    const without = ROLE_MENU_ASSIGNMENTS.find(
      (a) => !Object.prototype.hasOwnProperty.call(a.menus, MENU_SLUGS.FINANCE),
    );
    expect(without).toBeDefined();
    if (!without) {
      throw new Error("Expected a role without finance menu");
    }
    asRole(without.roleName);

    for (const [method, url, handler] of [...READS, ...WRITES]) {
      const res = await http(method, url);
      expect(res.status).toBe(403);
      expect(financeController[handler]).not.toHaveBeenCalled();
    }
  });

  it("users and API keys now agree: a key scoped `finance:read` reaches reads, not writes", async () => {
    asApiKey(["finance:read"]);

    for (const [method, url, handler] of READS) {
      const res = await http(method, url);
      expect(res.status).toBe(200);
      expect(financeController[handler]).toHaveBeenCalledTimes(1);
    }
    for (const [method, url, handler] of WRITES) {
      const res = await http(method, url);
      expect(res.status).toBe(403);
      expect(financeController[handler]).not.toHaveBeenCalled();
    }
  });

  it("a key scoped only `billing:*` no longer reaches asset finance", async () => {
    // The old OR gate let the `Billing` grant stand in for `finance`.
    asApiKey(["billing:*"]);

    const res = await http("get", "/");

    expect(res.status).toBe(403);
    expect(financeController["fetchAssetFinances"]).not.toHaveBeenCalled();
  });
});
