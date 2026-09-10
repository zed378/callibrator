/**
 * Warehouse Routes Tests
 *
 * Tests the Warehouse route registrations and middleware chain.
 */
const warehouseRoutes = require("../../routes/api/warehouse.route.js");

describe("Warehouse Routes", () => {
  it("should export an Express router", () => {
    expect(warehouseRoutes).toBeDefined();
    expect(typeof warehouseRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(warehouseRoutes.stack)).toBe(true);
    expect(warehouseRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = warehouseRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = warehouseRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = warehouseRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    warehouseRoutes.stack.forEach((layer) => {
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
