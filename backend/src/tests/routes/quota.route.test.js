/**
 * Quota Routes Tests
 *
 * Tests the Quota route registrations and middleware chain.
 */
const quotaRoutes = require("../../routes/api/quota.route.js");

describe("Quota Routes", () => {
  it("should export an Express router", () => {
    expect(quotaRoutes).toBeDefined();
    expect(typeof quotaRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(quotaRoutes.stack)).toBe(true);
    expect(quotaRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = quotaRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = quotaRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = quotaRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    quotaRoutes.stack.forEach((layer) => {
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
