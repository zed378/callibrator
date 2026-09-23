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

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((req, res, next) => next()),
  superAdminOnly: jest.fn((req, res, next) => next()),
  denyApiKey: jest.fn((req, res, next) => next()),
}));

const router = require("../../routes/api/tenantHierarchy.route");
const { auth, superAdminOnly, denyApiKey } = require("../../middlewares/auth.middleware");
const { ROLE_NAMES } = require("../../constants");

const layerFor = (path, method) =>
  router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);

const handlersFor = (path, method) => layerFor(path, method).route.stack.map((s) => s.handle);

// The guard is a closure created per route; it carries a name so it can be
// picked out of the stack without depending on handler order.
const guardFor = (path, method) => handlersFor(path, method).find((h) => h.name === "ownTenantGuard");

const run = (guard, user, params) => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
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

    it.each(paths)("%s lets the caller read its own tenant", (path) => {
      const { res, next } = run(guardFor(path, "get"), { tenantId: "t1", role: { name: "USER" } }, { tenantId: "t1" });
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    // 404, not 403: a 403 would confirm the other tenant exists.
    it.each(paths)("%s answers 404 for another tenant", (path) => {
      const { res, next } = run(guardFor(path, "get"), { tenantId: "t1", role: { name: "USER" } }, { tenantId: "t2" });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.body).toMatchObject({ success: false, status: 404, message: "Tenant not found" });
    });

    it.each(paths)("%s lets a super admin read any tenant", (path) => {
      const { res, next } = run(
        guardFor(path, "get"),
        { tenantId: "t1", role: { name: ROLE_NAMES.SUPER_ADMIN } },
        { tenantId: "t2" },
      );
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBeNull();
    });

    it("answers 404 when the principal has no resolvable tenant", () => {
      const { res, next } = run(guardFor("/:tenantId/children", "get"), undefined, { tenantId: "t2" });
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("re-parenting is a platform operation", () => {
    const mutations = [
      ["/:parentId/children", "post"],
      ["/:tenantId/parent", "put"],
      ["/:tenantId/parent", "delete"],
      ["/cross-tenant-roles", "get"],
    ];

    it.each(mutations)("%s %s requires auth, denies API keys and requires SUPERADMIN", (path, method) => {
      const handlers = handlersFor(path, method);
      expect(handlers).toContain(auth);
      expect(handlers).toContain(denyApiKey);
      expect(handlers).toContain(superAdminOnly);
    });
  });
});
