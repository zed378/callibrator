/**
 * Billing Routes Tests
 */
const billingRoutes = require("../../routes/api/billing.route");

describe("Billing Routes", () => {
  it("should export an Express router", () => {
    expect(billingRoutes).toBeDefined();
    expect(typeof billingRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(billingRoutes.stack)).toBe(true);
    expect(billingRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /subscription route", () => {
    const route = billingRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/subscription" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /subscription route", () => {
    const route = billingRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/subscription" && layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /invoices route", () => {
    const route = billingRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/invoices" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /webhook route", () => {
    const route = billingRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/webhook" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });
});
