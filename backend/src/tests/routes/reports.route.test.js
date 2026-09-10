/**
 * Reports Routes Tests
 *
 * Tests the Reports route registrations and middleware chain.
 */
const reportsRoutes = require("../../routes/api/reports.route.js");

describe("Reports Routes", () => {
  it("should export an Express router", () => {
    expect(reportsRoutes).toBeDefined();
    expect(typeof reportsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(reportsRoutes.stack)).toBe(true);
    expect(reportsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = reportsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = reportsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = reportsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    reportsRoutes.stack.forEach((layer) => {
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
});
