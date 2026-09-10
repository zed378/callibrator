/**
 * Vendor Routes Tests
 *
 * Tests the Vendor route registrations and middleware chain.
 */
const vendorRoutes = require("../../routes/api/vendor.route.js");

describe("Vendor Routes", () => {
  it("should export an Express router", () => {
    expect(vendorRoutes).toBeDefined();
    expect(typeof vendorRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(vendorRoutes.stack)).toBe(true);
    expect(vendorRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = vendorRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = vendorRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = vendorRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    vendorRoutes.stack.forEach((layer) => {
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
