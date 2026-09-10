/**
 * Tenant Hierarchy Routes Tests
 */
const tenantHierarchyRoutes = require("../../routes/api/tenantHierarchy.route");

describe("Tenant Hierarchy Routes", () => {
  it("should export an Express router", () => {
    expect(tenantHierarchyRoutes).toBeDefined();
    expect(typeof tenantHierarchyRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(tenantHierarchyRoutes.stack)).toBe(true);
    expect(tenantHierarchyRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /tree route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/tree" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:tenantId/children route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/children" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:tenantId/parent route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/parent" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /cross-tenant-roles route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/cross-tenant-roles" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });
});
