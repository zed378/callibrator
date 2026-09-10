/**
 * NetworkSecurity Routes Tests
 *
 * Tests the NetworkSecurity route registrations and middleware chain.
 */
const networksecurityRoutes = require("../../routes/api/networkSecurity.route.js");

describe("NetworkSecurity Routes", () => {
  it("should export an Express router", () => {
    expect(networksecurityRoutes).toBeDefined();
    expect(typeof networksecurityRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(networksecurityRoutes.stack)).toBe(true);
    expect(networksecurityRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = networksecurityRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = networksecurityRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = networksecurityRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    networksecurityRoutes.stack.forEach((layer) => {
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
