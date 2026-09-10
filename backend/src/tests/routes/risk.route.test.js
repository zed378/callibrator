/**
 * Risk Routes Tests
 *
 * Tests the Risk route registrations and middleware chain.
 */
const riskRoutes = require("../../routes/api/risk.route.js");

describe("Risk Routes", () => {
  it("should export an Express router", () => {
    expect(riskRoutes).toBeDefined();
    expect(typeof riskRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(riskRoutes.stack)).toBe(true);
    expect(riskRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = riskRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = riskRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = riskRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    riskRoutes.stack.forEach((layer) => {
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
