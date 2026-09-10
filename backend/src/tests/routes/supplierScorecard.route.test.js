/**
 * SupplierScorecard Routes Tests
 *
 * Tests the SupplierScorecard route registrations and middleware chain.
 */
const supplierscorecardRoutes = require("../../routes/api/supplierScorecard.route.js");

describe("SupplierScorecard Routes", () => {
  it("should export an Express router", () => {
    expect(supplierscorecardRoutes).toBeDefined();
    expect(typeof supplierscorecardRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(supplierscorecardRoutes.stack)).toBe(true);
    expect(supplierscorecardRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = supplierscorecardRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = supplierscorecardRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = supplierscorecardRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    supplierscorecardRoutes.stack.forEach((layer) => {
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
