/**
 * Maintenance Routes Tests
 */
const maintenanceRoutes = require("../../routes/api/maintenance.route");

describe("Maintenance Routes", () => {
  it("should export an Express router", () => {
    expect(maintenanceRoutes).toBeDefined();
    expect(typeof maintenanceRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(maintenanceRoutes.stack)).toBe(true);
    expect(maintenanceRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET / route", () => {
    const route = maintenanceRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:orderId route", () => {
    const route = maintenanceRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:orderId" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST / route", () => {
    const route = maintenanceRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /:orderId route", () => {
    const route = maintenanceRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:orderId" && layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:orderId route", () => {
    const route = maintenanceRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:orderId" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });
});
