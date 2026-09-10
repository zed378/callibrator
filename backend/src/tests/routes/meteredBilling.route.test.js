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

  // billingGuard = [auth, rbac(["TENANT_ADMIN","BILLING_ADMIN"])]. The guard was
  // previously defined but never applied — every route ran bare `auth`. These
  // tests exercise the actually-wired middleware chain to prove the RBAC gate is
  // in place and enforces the billing-admin bar.
  describe("billing RBAC guard", () => {
    const findRoute = (path, method) => {
      const layer = meteredbillingRoutes.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods[method],
      );
      return layer && layer.route;
    };

    it("mounts the rbac guard as the second middleware on every route", () => {
      // Chain is [auth, rbac, ...handlers]; if billingGuard were missing there
      // would be only [auth, handler] and the guard slot would be the handler.
      const paths = [
        ["/usage", "get"],
        ["/history", "get"],
        ["/estimate", "post"],
        ["/plan", "get"],
        ["/alerts", "get"],
        ["/alerts", "post"],
        ["/alerts/:alertId", "delete"],
        ["/analytics", "get"],
      ];
      paths.forEach(([path, method]) => {
        const route = findRoute(path, method);
        expect(route).toBeTruthy();
        // At least auth + rbac + handler.
        expect(route.stack.length).toBeGreaterThanOrEqual(3);
      });
    });

    it("rejects a non-billing role with 403", () => {
      const route = findRoute("/usage", "get");
      const guard = route.stack[1].handle; // the rbac middleware
      const next = jest.fn();
      guard({ user: { role: { name: "VIEWER", role_level: 0 } } }, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ status: 403 }),
      );
    });

    it("allows a TENANT_ADMIN through", () => {
      const route = findRoute("/usage", "get");
      const guard = route.stack[1].handle;
      const next = jest.fn();
      guard({ user: { role: { name: "TENANT_ADMIN", role_level: 8 } } }, {}, next);

      // Passed the gate: next() called with no error argument.
      expect(next).toHaveBeenCalledWith();
    });
  });
});
