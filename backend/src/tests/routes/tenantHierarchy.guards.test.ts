/**
 * Tenant Hierarchy Route Guards (A-01)
 *
 * The Tenant model has no `tenantId` attribute, so the global tenant hooks do
 * not scope it: these handlers read and WRITE any tenant in the platform by id.
 * Until 2026-09-23 every route carried `auth` and nothing else.
 *
 * tenantHierarchy.routes.test.js asserts only that the routes exist — it never
 * invokes a middleware. These cases drive the guards off the route stack.
 */
import type * as AuthMiddleware from "../../middlewares/auth.middleware";
import type * as ConstantsModule from "../../constants";
import type * as TenantHierarchyRoute from "../../routes/api/tenantHierarchy.route";

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((_req: unknown, _res: unknown, next: () => void) => { next(); }),
  superAdminOnly: jest.fn((_req: unknown, _res: unknown, next: () => void) => { next(); }),
  denyApiKey: jest.fn((_req: unknown, _res: unknown, next: () => void) => { next(); }),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const router = require("../../routes/api/tenantHierarchy.route") as typeof TenantHierarchyRoute;
const { auth, superAdminOnly, denyApiKey } = require("../../middlewares/auth.middleware") as typeof AuthMiddleware;
const { ROLE_NAMES } = require("../../constants") as typeof ConstantsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] };
}

const layerFor = (path: string, method: string) =>
  ((router.stack as unknown) as RouteLayer[]).find((l) => l.route?.path === path && l.route.methods[method] === true)
    ?.route;

const handlersFor = (path: string, method: string) =>
  (layerFor(path, method)?.stack ?? []).map((s) => s.handle);

// The guard is a closure created per route; it carries a name so it can be
// picked out of the stack without depending on handler order.
const guardFor = (path: string, method: string) =>
  handlersFor(path, method).find((h) => h.name === "ownTenantGuard") as
  | ((req: unknown, res: unknown, next: () => void) => void)
  | undefined;

const run = (
  guard: (req: unknown, res: unknown, next: () => void) => void,
  user: unknown,
  params: Record<string, string>,
) => {
  const res = {
    statusCode: null as number | null,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  guard({ user, params }, res, next);
  return { res, next };
};

describe("tenant-hierarchy route guards (A-01)", () => {
  describe("reads of a named tenant are limited to the caller's own tenant", () => {
    const paths = [
      "/:tenantId/children",
      "/:tenantId/parent",
      "/:tenantId/descendants",
      "/:tenantId/ancestors",
    ];

    it.each(paths)("%s lets the caller read its own tenant", (path: string) => {
      const guard = guardFor(path, "get");
      if (!guard) {
        throw new Error(`guard not found for ${path}`);
      }
      const { res, next } = run(guard, { tenantId: "t1", role: { name: "USER" } }, { tenantId: "t1" });
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    // 404, not 403: a 403 would confirm the other tenant exists.
    it.each(paths)("%s answers 404 for another tenant", (path: string) => {
      const guard = guardFor(path, "get");
      if (!guard) {
        throw new Error(`guard not found for ${path}`);
      }
      const { res, next } = run(guard, { tenantId: "t1", role: { name: "USER" } }, { tenantId: "t2" });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({ success: false, status: 404, message: "Tenant not found" });
    });

    it.each(paths)("%s lets a super admin read any tenant", (path: string) => {
      const guard = guardFor(path, "get");
      if (!guard) {
        throw new Error(`guard not found for ${path}`);
      }
      const { res, next } = run(
        guard,
        { tenantId: "t1", role: { name: ROLE_NAMES.SUPER_ADMIN } },
        { tenantId: "t2" },
      );
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it("answers 404 when the principal has no resolvable tenant", () => {
      const guard = guardFor("/:tenantId/children", "get");
      if (!guard) {
        throw new Error("guard not found");
      }
      const { res, next } = run(guard, undefined, { tenantId: "t2" });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("re-parenting is a platform operation", () => {
    const mutations: [string, string][] = [
      ["/:tenantId/children", "post"],
      ["/:tenantId/parent", "put"],
      ["/:tenantId/parent", "delete"],
      ["/cross-tenant-roles", "get"],
    ];

    it.each(mutations)("%s %s requires auth, denies API keys and requires SUPERADMIN", (path: string, method: string) => {
      const handlers = handlersFor(path, method);
      expect(handlers).toContain(auth);
      expect(handlers).toContain(denyApiKey);
      expect(handlers).toContain(superAdminOnly);
    });
  });
});
