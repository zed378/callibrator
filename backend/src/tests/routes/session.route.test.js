/**
 * Session Routes Tests
 *
 * Tests the Session route registrations and middleware chain.
 */
const sessionRoutes = require("../../routes/api/session.route.js");

describe("Session Routes", () => {
  it("should export an Express router", () => {
    expect(sessionRoutes).toBeDefined();
    expect(typeof sessionRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(sessionRoutes.stack)).toBe(true);
    expect(sessionRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = sessionRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = sessionRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = sessionRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    sessionRoutes.stack.forEach((layer) => {
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
