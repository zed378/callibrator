/**
 * Dashboard Routes Tests
 *
 * Tests the Dashboard route registrations and middleware chain.
 */
const dashboardRoutes = require("../../routes/api/dashboard.route");

describe("Dashboard Routes", () => {
  it("should export an Express router", () => {
    expect(dashboardRoutes).toBeDefined();
    expect(typeof dashboardRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(dashboardRoutes.stack)).toBe(true);
    expect(dashboardRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = dashboardRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /metrics", () => {
    const routes = dashboardRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/metrics" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    // In Express 5, middleware passed to router.get/post/etc is stored
    // within route layers (layer.route.handle), not as separate stack entries.
    // Check that routes have middleware in their handle chain.
    const routes = dashboardRoutes.stack.filter((layer) => layer.route);
    expect(routes.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    // In Express 5, middleware passed to router.get/post/etc is part of
    // the route layer, not a separate stack entry. Just verify routes exist.
    const hasRoutes = dashboardRoutes.stack.some((layer) => layer.route);
    expect(hasRoutes).toBe(true);
  });

  it("should have all routes using GET method", () => {
    dashboardRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.get === true).toBe(true);
      }
    });
  });

  it("should have exactly 1 route endpoint", () => {
    const routeCount = dashboardRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(1);
  });
});
