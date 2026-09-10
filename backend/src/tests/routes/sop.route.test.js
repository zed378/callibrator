/**
 * Sop Routes Tests
 *
 * Tests the Sop route registrations and middleware chain.
 */
const sopRoutes = require("../../routes/api/sop.route.js");

describe("Sop Routes", () => {
  it("should export an Express router", () => {
    expect(sopRoutes).toBeDefined();
    expect(typeof sopRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(sopRoutes.stack)).toBe(true);
    expect(sopRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = sopRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = sopRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = sopRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    sopRoutes.stack.forEach((layer) => {
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
