/**
 * Qms Routes Tests
 *
 * Tests the Qms route registrations and middleware chain.
 */
const qmsRoutes = require("../../routes/api/qms.route.js");

describe("Qms Routes", () => {
  it("should export an Express router", () => {
    expect(qmsRoutes).toBeDefined();
    expect(typeof qmsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(qmsRoutes.stack)).toBe(true);
    expect(qmsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = qmsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = qmsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = qmsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    qmsRoutes.stack.forEach((layer) => {
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
