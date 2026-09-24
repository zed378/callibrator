/**
 * MeteredBilling Routes Tests
 *
 * Tests the MeteredBilling route registrations and middleware chain.
 */
const meteredbillingRoutes = require("../../routes/api/meteredBilling.route.js");

describe("MeteredBilling Routes", () => {
  it("should export an Express router", () => {
    expect(meteredbillingRoutes).toBeDefined();
    expect(typeof meteredbillingRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(meteredbillingRoutes.stack)).toBe(true);
    expect(meteredbillingRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = meteredbillingRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = meteredbillingRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = meteredbillingRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    meteredbillingRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods.get === true;
        const hasPost = methods.post === true;
        const hasPut = methods.put === true;
        const hasDelete = methods.delete === true;
        expect(hasGet || hasPost || hasPut || hasDelete).toBe(true);
      }
    });
  });

  // ADR-043. The guard was `rbac(["TENANT_ADMIN", "BILLING_ADMIN"])` and these
  // tests drove it synchronously with a hand-built `role_level` and an empty
  // `res` — a principal no loader produces, which is why the tenant-admin
  // lockout (V-01) was invisible here. The route now uses
  // `dynamicAccess("metered-billing", "read" | "write")`, which is async, reads
  // the role's menu matrix by `role.id`, and answers through `res`. These tests
  // drive the REAL dynamicAccess with the matrix exactly as the seed builds it
  // (ROLE_MENU_ASSIGNMENTS) and a principal shaped like the one `auth` attaches.
  describe("billing permission guard (dynamicAccess metered-billing)", () => {
    const RolesService = require("../../services/roles.service");
    const userPermissionService = require("../../services/userPermission.service");
    const {
      ROLE_NAMES,
      ROLE_IDS,
      ROLE_LEVELS,
      ROLE_MENU_ASSIGNMENTS,
      MENU_SLUGS,
    } = require("../../constants");

    const TENANT = "33333333-3333-4333-8333-333333333333";

    // Role name -> the ROLE_IDS / ROLE_LEVELS key it is seeded under.
    const KEY_FOR = {
      [ROLE_NAMES.HEALTCARE_ADMIN]: "HEALTCARE_ADMIN",
      [ROLE_NAMES.CALIBRATOR_ADMIN]: "CALIBRATOR_ADMIN",
      [ROLE_NAMES.ROOM_USER]: "ROOM_USER",
      [ROLE_NAMES.ENGINEERING_MANAGER]: "ENGINEERING_MANAGER",
    };

    const matrixByRoleId = {};
    for (const a of ROLE_MENU_ASSIGNMENTS) {
      const key = KEY_FOR[a.roleName];
      if (!key) {continue;}
      const m = {};
      for (const [slug, perm] of Object.entries(a.menus)) {m[slug] = [perm];}
      matrixByRoleId[ROLE_IDS[key]] = m;
    }

    // The shape auth.middleware attaches (getAuthUserWithTenant's projection).
    const principal = (roleName) => {
      const key = KEY_FOR[roleName];
      return {
        id: "44444444-4444-4444-8444-444444444444",
        tenantId: TENANT,
        role: {
          id: ROLE_IDS[key],
          name: roleName,
          description: roleName,
          roleLevel: ROLE_LEVELS[key],
        },
      };
    };

    const makeRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    });

    const findRoute = (path, method) => {
      const layer = meteredbillingRoutes.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods[method],
      );
      return layer && layer.route;
    };

    // stack[0] is auth; stack[1] is the permission gate.
    const runGuard = async (path, method, user) => {
      const guard = findRoute(path, method).stack[1].handle;
      const req = { user, params: {}, body: {}, query: {}, method: method.toUpperCase() };
      const res = makeRes();
      const next = jest.fn();
      await guard(req, res, next);
      return { req, res, next };
    };

    let overrides;
    beforeEach(() => {
      overrides = {};
      jest
        .spyOn(RolesService, "getRolePermissionsMatrix")
        .mockImplementation(async (roleId) => matrixByRoleId[roleId] || {});
      jest
        .spyOn(userPermissionService, "getUserOverrideMatrix")
        .mockImplementation(async () => overrides);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const ROUTES = [
      ["/usage", "get", "read"],
      ["/history", "get", "read"],
      ["/estimate", "post", "read"],
      ["/plan", "get", "read"],
      ["/alerts", "get", "read"],
      ["/alerts", "post", "write"],
      ["/alerts/:alertId", "delete", "write"],
      ["/analytics", "get", "read"],
    ];

    it("mounts auth + a permission gate + handler on every route", () => {
      ROUTES.forEach(([path, method]) => {
        const route = findRoute(path, method);
        expect(route).toBeTruthy();
        expect(route.stack.length).toBeGreaterThanOrEqual(3);
      });
    });

    it("the seed grants metered-billing to both tenant-admin roles (migration 0021's premise)", () => {
      expect(
        matrixByRoleId[ROLE_IDS.HEALTCARE_ADMIN][MENU_SLUGS.METERED_BILLING],
      ).toEqual(["write"]);
      expect(
        matrixByRoleId[ROLE_IDS.CALIBRATOR_ADMIN][MENU_SLUGS.METERED_BILLING],
      ).toEqual(["write"]);
    });

    it.each(ROUTES)(
      "%s %s admits a HEALTHCARE ADMIN (the V-01 lockout does not recur)",
      async (path, method) => {
        const { next, res } = await runGuard(
          path,
          method,
          principal(ROLE_NAMES.HEALTCARE_ADMIN),
        );
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
      },
    );

    it.each(ROUTES)(
      "%s %s admits a CALIBRATOR ADMIN",
      async (path, method) => {
        const { next, res } = await runGuard(
          path,
          method,
          principal(ROLE_NAMES.CALIBRATOR_ADMIN),
        );
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
      },
    );

    it.each(ROUTES)(
      "%s %s refuses a ROOM USER with 403 (in-tenant permission failure)",
      async (path, method) => {
        const { next, res } = await runGuard(
          path,
          method,
          principal(ROLE_NAMES.ROOM_USER),
        );
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          status: 403,
          message: "Forbidden: Insufficient permissions",
          data: null,
        });
      },
    );

    it("refuses an ENGINEERING MANAGER, who has no metered-billing row at all", async () => {
      const { next, res } = await runGuard(
        "/usage",
        "get",
        principal(ROLE_NAMES.ENGINEERING_MANAGER),
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("separates read from write: a read-only override may read usage but not create an alert", async () => {
      overrides = { [MENU_SLUGS.METERED_BILLING]: "read" };
      const admin = principal(ROLE_NAMES.HEALTCARE_ADMIN);

      const read = await runGuard("/usage", "get", admin);
      expect(read.next).toHaveBeenCalledWith();

      const write = await runGuard("/alerts", "post", admin);
      expect(write.next).not.toHaveBeenCalled();
      expect(write.res.status).toHaveBeenCalledWith(403);

      const del = await runGuard("/alerts/:alertId", "delete", admin);
      expect(del.next).not.toHaveBeenCalled();
      expect(del.res.status).toHaveBeenCalledWith(403);
    });

    it("refuses with 401 when no principal is attached", async () => {
      const { next, res } = await runGuard("/usage", "get", undefined);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
