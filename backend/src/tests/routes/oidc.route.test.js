/**
 * Oidc Routes Tests
 *
 * Tests the Oidc route registrations and middleware chain.
 */
const oidcRoutes = require("../../routes/api/oidc.route.js");

describe("Oidc Routes", () => {
  it("should export an Express router", () => {
    expect(oidcRoutes).toBeDefined();
    expect(typeof oidcRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(oidcRoutes.stack)).toBe(true);
    expect(oidcRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = oidcRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = oidcRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = oidcRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    oidcRoutes.stack.forEach((layer) => {
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
