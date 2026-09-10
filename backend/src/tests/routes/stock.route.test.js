/**
 * Stock Routes Tests
 *
 * Tests the Stock route registrations and middleware chain.
 */
const stockRoutes = require("../../routes/api/stock.route.js");

describe("Stock Routes", () => {
  it("should export an Express router", () => {
    expect(stockRoutes).toBeDefined();
    expect(typeof stockRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(stockRoutes.stack)).toBe(true);
    expect(stockRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = stockRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = stockRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = stockRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    stockRoutes.stack.forEach((layer) => {
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
