/**
 * Finance Routes Tests
 */
const financeRoutes = require("../../routes/api/finance.route");

describe("Finance Routes", () => {
  it("should export an Express router", () => {
    expect(financeRoutes).toBeDefined();
    expect(typeof financeRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(financeRoutes.stack)).toBe(true);
    expect(financeRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /reports/depreciation route", () => {
    const route = financeRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/reports/depreciation" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET / route", () => {
    const route = financeRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST / route", () => {
    const route = financeRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /:financeId route", () => {
    const route = financeRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:financeId" && layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:financeId route", () => {
    const route = financeRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:financeId" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });
});
