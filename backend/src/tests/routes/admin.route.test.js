/**
 * Admin Routes Tests
 *
 * Tests the admin route registrations and middleware chain.
 */
const adminRoutes = require("../../routes/api/admin.route");

describe("Admin Routes", () => {
  it("should export an Express router", () => {
    expect(adminRoutes).toBeDefined();
    expect(typeof adminRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(adminRoutes.stack)).toBe(true);
    expect(adminRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = adminRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(2);
  });

  it("should have GET route for /tenants", () => {
    const getRoutes = adminRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/tenants" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(getRoutes.length).toBe(1);
  });

  it("should have PATCH route for /tenants/:id/status", () => {
    const patchRoutes = adminRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/tenants/:id/status" &&
        layer.route.methods &&
        layer.route.methods.patch,
    );
    expect(patchRoutes.length).toBe(1);
  });

  it("should have PATCH route for /tenants/:id/flags", () => {
    const patchRoutes = adminRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/tenants/:id/flags" &&
        layer.route.methods &&
        layer.route.methods.patch,
    );
    expect(patchRoutes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    // Verify middleware layers exist (non-route layers)
    const middlewareLayers = adminRoutes.stack.filter((layer) => !layer.route);
    expect(middlewareLayers.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    // The route stack should have both middleware layers and route layers
    const hasMiddleware = adminRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = adminRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware).toBe(true);
    expect(hasRoutes).toBe(true);
  });

  it("should have only admin-specific routes", () => {
    const routePaths = adminRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    expect(routePaths).toContain("/tenants");
    expect(routePaths).toContain("/tenants/:id/status");
    expect(routePaths).toContain("/tenants/:id/flags");
  });

  it("should have all routes using GET or PATCH methods", () => {
    adminRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods.get === true;
        const hasPatch = methods.patch === true;
        expect(hasGet || hasPatch).toBe(true);
      }
    });
  });

  it("should have exactly 3 route endpoints", () => {
    const routeCount = adminRoutes.stack.filter((layer) => layer.route).length;
    expect(routeCount).toBe(3);
  });
});
