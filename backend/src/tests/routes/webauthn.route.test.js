/**
 * Webauthn Routes Tests
 *
 * Tests the Webauthn route registrations and middleware chain.
 */
const webauthnRoutes = require("../../routes/api/webauthn.route.js");

describe("Webauthn Routes", () => {
  it("should export an Express router", () => {
    expect(webauthnRoutes).toBeDefined();
    expect(typeof webauthnRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(webauthnRoutes.stack)).toBe(true);
    expect(webauthnRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = webauthnRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = webauthnRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = webauthnRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    webauthnRoutes.stack.forEach((layer) => {
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
