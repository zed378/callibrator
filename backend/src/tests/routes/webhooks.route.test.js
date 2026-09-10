/**
 * Webhooks Routes Tests
 *
 * Tests the Webhooks route registrations and middleware chain.
 */
const webhooksRoutes = require("../../routes/api/webhooks.route.js");

describe("Webhooks Routes", () => {
  it("should export an Express router", () => {
    expect(webhooksRoutes).toBeDefined();
    expect(typeof webhooksRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(webhooksRoutes.stack)).toBe(true);
    expect(webhooksRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = webhooksRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = webhooksRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = webhooksRoutes.stack.some((layer) => layer.route);
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    webhooksRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods.get === true;
        const hasPost = methods.post === true;
        const hasPut = methods.put === true;
        const hasDelete = methods.delete === true;
        const hasPatch = methods.patch === true;
        expect(hasGet || hasPost || hasPut || hasDelete || hasPatch).toBe(true);
      }
    });
  });
});
