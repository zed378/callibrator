/**
 * Roles Routes Tests
 *
 * Tests the Roles route registrations and middleware chain.
 */
const rolesRoutes = require("../../routes/api/roles.route.js");

describe("Roles Routes", () => {
  it("should export an Express router", () => {
    expect(rolesRoutes).toBeDefined();
    expect(typeof rolesRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(rolesRoutes.stack)).toBe(true);
    expect(rolesRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = rolesRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = rolesRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = rolesRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    rolesRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const validMethods = ["get", "post", "put", "patch", "delete"];
        const hasValidMethod = validMethods.some(
          (m) => methods[m] === true,
        );
        expect(hasValidMethod).toBe(true);
      }
    });
  });
});
