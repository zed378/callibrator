/**
 * Workflows Routes Tests
 *
 * Tests the Workflows route registrations and middleware chain.
 */
const workflowsRoutes = require("../../routes/api/workflows.route.js");

describe("Workflows Routes", () => {
  it("should export an Express router", () => {
    expect(workflowsRoutes).toBeDefined();
    expect(typeof workflowsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(workflowsRoutes.stack)).toBe(true);
    expect(workflowsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = workflowsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = workflowsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = workflowsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    workflowsRoutes.stack.forEach((layer) => {
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
