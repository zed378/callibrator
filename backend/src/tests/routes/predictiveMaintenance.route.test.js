/**
 * PredictiveMaintenance Routes Tests
 *
 * Tests the PredictiveMaintenance route registrations and middleware chain.
 */
const predictivemaintenanceRoutes = require("../../routes/api/predictiveMaintenance.route.js");

describe("PredictiveMaintenance Routes", () => {
  it("should export an Express router", () => {
    expect(predictivemaintenanceRoutes).toBeDefined();
    expect(typeof predictivemaintenanceRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(predictivemaintenanceRoutes.stack)).toBe(true);
    expect(predictivemaintenanceRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = predictivemaintenanceRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = predictivemaintenanceRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = predictivemaintenanceRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    predictivemaintenanceRoutes.stack.forEach((layer) => {
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
