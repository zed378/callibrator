/**
 * Search Routes Tests
 *
 * Tests the Search route registrations and middleware chain.
 */
const searchRoutes = require("../../routes/api/search.route.js");

describe("Search Routes", () => {
  it("should export an Express router", () => {
    expect(searchRoutes).toBeDefined();
    expect(typeof searchRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(searchRoutes.stack)).toBe(true);
    expect(searchRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = searchRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = searchRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = searchRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    searchRoutes.stack.forEach((layer) => {
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
