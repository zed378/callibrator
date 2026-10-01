/**
 * ADR-102 — services/effectivePermission: the one effective-permission
 * function (API gate, sidebar, page write buttons), its rbac() mirror, and
 * the page-gate table (constants/menuPageAccess) against the route files it
 * quotes.
 *
 * rbacAllows is checked against the REAL rbac() middleware for every seeded
 * role × every role list a route passes (parity, not a copy of the rule).
 * The page-gate table is checked against the route SOURCE: a route that
 * changes a page's gate fails here until the table follows.
 */
import fs from "fs";
import path from "path";

import { ROLE_LEVELS, ROLE_NAMES } from "../../constants/roleConstants";
import { MENU_PAGE_GATES, MENU_PAGE_GATE_SOURCES } from "../../constants/menuPageAccess";
import { toUserId } from "../../types/ids";
import type * as EffectivePermission from "../../services/effectivePermission.service";

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- the mocked JavaScript-era services, typed by the members used */
const RolesService = require("../../services/roles.service") as { getRolePermissionsMatrix: jest.Mock };
const userPermissionService = require("../../services/userPermission.service") as { getUserOverrideMatrix: jest.Mock };
const ep = require("../../services/effectivePermission.service") as typeof EffectivePermission;
const { rbac } = require("../../middlewares/rbac.middleware") as {
  rbac: (roles: string[]) => (req: object, res: object, next: (err?: unknown) => void) => void;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const USER = toUserId("0f0f0f0f-0000-4000-8000-000000000201");

beforeEach(() => {
  RolesService.getRolePermissionsMatrix.mockResolvedValue({ equipment: ["write"], calibration: ["write"], warehouse: ["read"] });
  userPermissionService.getUserOverrideMatrix.mockResolvedValue({});
});

describe("loadPermissionSources", () => {
  it("the super admin needs no lookup and passes every menu gate", async () => {
    const sources = await ep.loadPermissionSources({ id: USER, role: { id: "r", name: "SUPERADMIN" } });
    expect(sources.superAdmin).toBe(true);
    expect(RolesService.getRolePermissionsMatrix).not.toHaveBeenCalled();
    expect(ep.allows(sources, "anything", "write")).toBe(true);
    expect(ep.isSuperAdmin({ role: { name: "SUPER_ADMIN" } })).toBe(true);
  });

  it("no role id: no role grants; no user id: no override lookup", async () => {
    const sources = await ep.loadPermissionSources({ role: { name: "USER" } });
    expect(sources.matrix).toEqual({});
    expect(userPermissionService.getUserOverrideMatrix).not.toHaveBeenCalled();
    expect(ep.accessOf(sources, "equipment")).toBeNull();
  });

  it("a failed override lookup falls back to the role grants and reports the error", async () => {
    userPermissionService.getUserOverrideMatrix.mockRejectedValueOnce(new Error("redis down"));
    const seen: string[] = [];
    const sources = await ep.loadPermissionSources({ id: USER, role: { id: "r", name: "USER" } }, (e) => seen.push(e.message));
    expect(seen).toEqual(["redis down"]);
    expect(ep.accessOf(sources, "equipment")).toBe("write");
  });

  it("a failed lookup with no handler, and a non-Error rejection, are tolerated", async () => {
    userPermissionService.getUserOverrideMatrix.mockRejectedValueOnce("boom");
    await expect(ep.loadPermissionSources({ id: USER, role: { id: "r", name: "USER" } })).resolves.toMatchObject({
      superAdmin: false,
    });
    userPermissionService.getUserOverrideMatrix.mockRejectedValueOnce("boom");
    const seen: string[] = [];
    await ep.loadPermissionSources({ id: USER, role: { id: "r", name: "USER" } }, (e) => seen.push(e.message));
    expect(seen).toEqual(["boom"]);
  });
});

describe("the rule", () => {
  it("an override replaces the role's access; `none` revokes; write implies read; any verb but read needs write", async () => {
    userPermissionService.getUserOverrideMatrix.mockResolvedValueOnce({ calibration: "none", warehouse: "write", audit: "read" });
    const sources = await ep.loadPermissionSources({ id: USER, role: { id: "r", name: "USER" } });
    expect(ep.accessOf(sources, "calibration")).toBeNull();
    expect(ep.accessOf(sources, "warehouse")).toBe("write");
    expect(ep.accessOf(sources, "audit")).toBe("read");
    expect(ep.allows(sources, "equipment", "approve")).toBe(true);
    expect(ep.allows(sources, "audit", "approve")).toBe(false);
    expect(ep.normalizePermission("READ")).toBe("read");
    expect(ep.effectivePermissionMap(sources, ["equipment", "calibration", "audit", "nothing"])).toEqual({
      equipment: "write",
      audit: "read",
    });
  });
});

describe("rbacAllows is rbac()'s own decision", () => {
  const lists: string[][] = [
    [ROLE_NAMES.SUPER_ADMIN],
    [ROLE_NAMES.TENANT_ADMIN],
    [ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN],
    ["TENANT_ADMIN", "BILLING_ADMIN"],
    ["NOT_A_ROLE"],
    [],
  ];
  const principals: { role: { name: string; roleLevel: number } }[] = (
    Object.keys(ROLE_NAMES) as (keyof typeof ROLE_NAMES)[]
  ).map((key) => ({
    role: { name: ROLE_NAMES[key], roleLevel: ROLE_LEVELS[key] },
  }));
  principals.push({ role: { name: "CUSTOM ROLE", roleLevel: 0 } });

  const viaMiddleware = (principal: object, roles: string[]): boolean => {
    let allowed = false;
    rbac(roles)({ user: principal }, {}, (err?: unknown) => {
      allowed = err === undefined;
    });
    return allowed;
  };

  it.each(lists.map((l) => [l.join(",") || "(none)", l] as const))("roles %s", (_label, roles) => {
    for (const principal of principals) {
      expect([principal.role.name, ep.rbacAllows(principal, roles)]).toEqual([
        principal.role.name,
        viaMiddleware(principal, roles),
      ]);
    }
  });

  it("a principal with no role name is refused (rbac: Unauthorized)", () => {
    expect(ep.rbacAllows({ role: null }, [ROLE_NAMES.TENANT_ADMIN])).toBe(false);
    expect(ep.rbacAllows({ role: { name: "USER", role_level: 9 } }, [ROLE_NAMES.TENANT_ADMIN])).toBe(true);
  });
});

describe("page gates", () => {
  it("menuEntryVisible needs the slug's own read AND every gate of its page", async () => {
    const sources = await ep.loadPermissionSources({ id: USER, role: { id: "r", name: "USER" } });
    const user = { role: { name: "USER", roleLevel: 1 } };
    // calibration-scheduler is gated by `maintenance`, which this role lacks.
    RolesService.getRolePermissionsMatrix.mockResolvedValueOnce({ "calibration-scheduler": ["read"] });
    const noMaintenance = await ep.loadPermissionSources({ role: { id: "r", name: "USER" } });
    expect(ep.menuEntryVisible(user, noMaintenance, "calibration-scheduler")).toBe(false);
    expect(ep.menuEntryVisible(user, sources, "calibration")).toBe(true);
    expect(ep.menuEntryVisible(user, sources, "audit")).toBe(false);
    // tickets-raise: not for the super admin, whatever it holds.
    const sa = await ep.loadPermissionSources({ role: { name: "SUPERADMIN" } });
    expect(ep.menuEntryVisible({ role: { name: "SUPERADMIN" } }, sa, "tickets-raise")).toBe(false);
    expect(ep.gatePasses(user, sources, { kind: "notSuperAdmin" })).toBe(true);
  });

  it("every quoted gate is still in its route file", () => {
    const routes = path.join(__dirname, "..", "..", "routes", "api");
    // P9-21: the table names each route module without its extension; read the
    // one that exists (`.ts` once converted, `.js` before) — exactly one must.
    const sourceOf = (file: string): string => {
      const found = [".ts", ".js"].map((ext) => path.join(routes, file + ext)).filter((f) => fs.existsSync(f));
      expect([file, found.length]).toEqual([file, 1]);
      return fs.readFileSync(found[0] ?? "", "utf8");
    };
    for (const [slug, { file, text }] of Object.entries(MENU_PAGE_GATE_SOURCES)) {
      expect([slug, sourceOf(file).includes(text)]).toEqual([slug, true]);
    }
    // Every gated slug but tickets-raise (a service rule) is quoted.
    expect(Object.keys(MENU_PAGE_GATES).filter((s) => !(s in MENU_PAGE_GATE_SOURCES))).toEqual(["tickets-raise"]);
  });

  it("the slugs migration 0097 grants are no dynamicAccess gate anywhere (the grants widen no API access)", () => {
    const routes = path.join(__dirname, "..", "..", "routes", "api");
    const source = fs
      .readdirSync(routes)
      .filter((f) => f.endsWith(".js") || f.endsWith(".ts"))
      .map((f) => fs.readFileSync(path.join(routes, f), "utf8"))
      .join("\n");
    const granted = ["stock", "storage", "tenants", "tenant-hierarchy", "kanban", "api-keys", "webhooks", "attachments"];
    const constantOf: Readonly<Record<string, string>> = {
      stock: "STOCK", storage: "STORAGE", tenants: "TENANTS", "tenant-hierarchy": "TENANT_HIERARCHY",
      kanban: "KANBAN", "api-keys": "API_KEYS", webhooks: "WEBHOOKS", attachments: "ATTACHMENTS",
    };
    for (const slug of granted) {
      expect([slug, source.includes(`dynamicAccess("${slug}"`)]).toEqual([slug, false]);
      expect([slug, source.includes(`dynamicAccess(MENU_SLUGS.${constantOf[slug] ?? slug}`)]).toEqual([slug, false]);
    }
  });
});
